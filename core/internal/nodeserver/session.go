package nodeserver

import (
	"net"
	"sync"

	"github.com/honeybee-enhanced/shared/protocol"
)

// Session represents one live node connection.
type Session struct {
	conn    net.Conn
	nodeID  int64
	orgID   int64
	writeMu *sync.Mutex

	// LogAnalyzer state cached per-session so the hot event path doesn't hit
	// the DB. Mutated only under laMu.
	laMu      sync.RWMutex
	laEnabled bool
	laToken   string
	laWsID    string
}

// NodeID returns the node's primary key.
func (s *Session) NodeID() int64 { return s.nodeID }

// OrgID returns the owning organization.
func (s *Session) OrgID() int64 { return s.orgID }

// LAState returns the cached LogAnalyzer attachment for this session.
func (s *Session) LAState() (enabled bool, token, workspaceID string) {
	s.laMu.RLock()
	defer s.laMu.RUnlock()
	return s.laEnabled, s.laToken, s.laWsID
}

// SetLA atomically updates the cached LogAnalyzer attachment.
func (s *Session) SetLA(enabled bool, token, workspaceID string) {
	s.laMu.Lock()
	s.laEnabled = enabled
	s.laToken = token
	s.laWsID = workspaceID
	s.laMu.Unlock()
}

// Send serializes a message and writes it to the underlying connection.
// A per-session mutex guarantees frames are not interleaved.
func (s *Session) Send(msgType string, payload any) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return protocol.SendMessage(s.conn, msgType, payload)
}

// Close terminates the session connection.
func (s *Session) Close() error {
	if s.conn == nil {
		return nil
	}
	return s.conn.Close()
}
