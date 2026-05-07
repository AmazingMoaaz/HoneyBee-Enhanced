// Package nodeserver implements the TCP server that field nodes connect to.
package nodeserver

import (
	"context"
	"crypto/subtle"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"strconv"
	"sync"
	"time"

	"github.com/honeybee-enhanced/core/internal/api/ws"
	"github.com/honeybee-enhanced/core/internal/store"
	"github.com/honeybee-enhanced/shared/protocol"
	"golang.org/x/crypto/bcrypt"
)

// Server accepts node TCP connections and manages live sessions.
type Server struct {
	addr        string
	tlsConfig   *tls.Config
	store       *store.Store
	logger      *slog.Logger
	broadcaster ws.Broadcaster

	mu       sync.RWMutex
	sessions map[int64]*Session // nodeID -> session

	dispatcher *Dispatcher
	listener   net.Listener
}

// Config contains construction-time options.
type Config struct {
	Addr      string
	TLSConfig *tls.Config
}

// NewServer constructs a Server.
func NewServer(cfg Config, st *store.Store, logger *slog.Logger) *Server {
	s := &Server{
		addr:      cfg.Addr,
		tlsConfig: cfg.TLSConfig,
		store:     st,
		logger:    logger,
		sessions:  make(map[int64]*Session),
	}
	s.dispatcher = NewDispatcher(st, s, logger)
	return s
}

// SetBroadcaster wires in the WS hub for live event fan-out.
func (s *Server) SetBroadcaster(b ws.Broadcaster) {
	s.broadcaster = b
	s.dispatcher.broadcaster = b
}

// Sessions returns a snapshot of currently online node IDs.
func (s *Server) Sessions() []int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]int64, 0, len(s.sessions))
	for id := range s.sessions {
		out = append(out, id)
	}
	return out
}

// Session returns the active session for a nodeID, if any.
func (s *Server) Session(nodeID int64) (*Session, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sess, ok := s.sessions[nodeID]
	return sess, ok
}

// IsOnline returns true if the given node has an active session.
func (s *Server) IsOnline(nodeID int64) bool {
	_, ok := s.Session(nodeID)
	return ok
}

// ConnectedCount returns the number of nodes with an active WebSocket session.
func (s *Server) ConnectedCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.sessions)
}

// SendToNode delivers a TaskAssign to the node if online.
func (s *Server) SendToNode(nodeID int64, taskID int64, command string, payload any) error {
	sess, ok := s.Session(nodeID)
	if !ok {
		return fmt.Errorf("node %d offline", nodeID)
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	ta := protocol.TaskAssign{TaskID: taskID, Command: command, Payload: raw}
	return sess.Send(protocol.MsgTaskAssign, ta)
}

// SendCommand is a fire-and-forget helper (taskID=0, no task record).
func (s *Server) SendCommand(nodeID int64, command string, payload any) error {
	return s.SendToNode(nodeID, 0, command, payload)
}

// Start begins accepting connections; blocks until the listener fails or ctx is canceled.
func (s *Server) Start(ctx context.Context) error {
	var err error
	if s.tlsConfig != nil {
		s.listener, err = tls.Listen("tcp", s.addr, s.tlsConfig)
	} else {
		s.listener, err = net.Listen("tcp", s.addr)
	}
	if err != nil {
		return fmt.Errorf("listen %s: %w", s.addr, err)
	}
	s.logger.Info("node server listening", slog.String("addr", s.addr), slog.Bool("tls", s.tlsConfig != nil))

	go func() {
		<-ctx.Done()
		_ = s.listener.Close()
	}()

	for {
		conn, err := s.listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			s.logger.Warn("accept error", slog.Any("err", err))
			continue
		}
		go s.handleConn(ctx, conn)
	}
}

func (s *Server) handleConn(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	remote := conn.RemoteAddr().String()
	s.logger.Debug("node connection", slog.String("remote", remote))

	env, err := protocol.ReadMessage(conn)
	if err != nil {
		s.logger.Warn("read auth failed", slog.String("remote", remote), slog.Any("err", err))
		return
	}
	if env.Type != protocol.MsgNodeAuth {
		s.logger.Warn("first message not auth", slog.String("type", env.Type))
		_ = protocol.SendMessage(conn, protocol.MsgAuthResult, protocol.AuthResult{Success: false, Message: "expected node_auth"})
		return
	}

	var auth protocol.NodeAuth
	if err := protocol.DecodePayload(env, &auth); err != nil {
		_ = protocol.SendMessage(conn, protocol.MsgAuthResult, protocol.AuthResult{Success: false, Message: "bad payload"})
		return
	}

	node, err := s.authenticateToken(ctx, auth.Token)
	if err != nil {
		s.logger.Info("auth rejected", slog.String("remote", remote), slog.Any("err", err))
		_ = protocol.SendMessage(conn, protocol.MsgAuthResult, protocol.AuthResult{Success: false, Message: "invalid token"})
		return
	}

	// Replace any previous session for this node.
	s.mu.Lock()
	if old, ok := s.sessions[node.ID]; ok {
		_ = old.conn.Close()
		delete(s.sessions, node.ID)
	}
	sess := &Session{
		conn:    conn,
		nodeID:  node.ID,
		orgID:   node.OrgID,
		writeMu: &sync.Mutex{},
	}
	s.sessions[node.ID] = sess
	s.mu.Unlock()

	if err := s.store.UpdateNodeRegistration(ctx, node.ID, auth.Hostname, auth.OS, auth.Arch); err != nil {
		s.logger.Warn("update node registration", slog.Any("err", err))
	}
	if err := protocol.SendMessage(conn, protocol.MsgAuthResult, protocol.AuthResult{Success: true, NodeID: node.ID, Message: "ok"}); err != nil {
		s.removeSession(ctx, node.ID)
		return
	}
	s.logger.Info("node online", slog.Int64("node_id", node.ID), slog.String("hostname", auth.Hostname))

	if s.broadcaster != nil {
		s.broadcaster.Broadcast(node.OrgID, "node_events", "node_status", map[string]any{
			"node_id":  node.ID,
			"hostname": auth.Hostname,
			"status":   "online",
			"online":   true,
		})
	}

	// Flush pending tasks
	go s.dispatcher.FlushPending(ctx, node.ID, sess)

	// Block reading messages
	for {
		msgEnv, err := protocol.ReadMessage(conn)
		if err != nil {
			s.logger.Info("node read err", slog.Int64("node_id", node.ID), slog.Any("err", err))
			break
		}
		s.dispatcher.Dispatch(ctx, sess, msgEnv)
	}

	s.removeSession(ctx, node.ID)
}

func (s *Server) removeSession(ctx context.Context, nodeID int64) {
	s.mu.Lock()
	sess, ok := s.sessions[nodeID]
	if ok {
		delete(s.sessions, nodeID)
	}
	s.mu.Unlock()
	if !ok {
		return
	}
	_ = s.store.MarkNodeOffline(ctx, nodeID)
	_ = s.store.ResetSentTasksForNode(ctx, nodeID)
	if s.broadcaster != nil {
		s.broadcaster.Broadcast(sess.orgID, "node_events", "node_status", map[string]any{
			"node_id": nodeID,
			"status":  "offline",
			"online":  false,
		})
	}
	s.logger.Info("node offline", slog.Int64("node_id", nodeID))
}

func (s *Server) authenticateToken(ctx context.Context, token string) (*nodeRef, error) {
	if token == "" {
		return nil, errors.New("empty token")
	}
	// We must match against bcrypt hashes; iterate over all (small set in practice).
	nodes, err := s.store.ListAllNodes(ctx)
	if err != nil {
		return nil, err
	}
	for i := range nodes {
		n := &nodes[i]
		if err := bcrypt.CompareHashAndPassword([]byte(n.TokenHash), []byte(token)); err == nil {
			return &nodeRef{ID: n.ID, OrgID: n.OrgID}, nil
		}
	}
	return nil, errors.New("no matching token")
}

type nodeRef struct {
	ID    int64
	OrgID int64
}

// DisconnectNode forcibly closes the active session for a node (used on delete/regenerate-token).
func (s *Server) DisconnectNode(nodeID int64) {
	s.mu.RLock()
	sess, ok := s.sessions[nodeID]
	s.mu.RUnlock()
	if ok && sess.conn != nil {
		_ = sess.conn.Close()
	}
}

// _ keeps imports tidy.
var _ = subtle.ConstantTimeCompare
var _ = strconv.Itoa
var _ = time.Now
