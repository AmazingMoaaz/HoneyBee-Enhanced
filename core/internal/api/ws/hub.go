// Package ws implements an org-scoped WebSocket hub with topic subscriptions.
package ws

import (
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait     = 10 * time.Second
	pongWait      = 60 * time.Second
	pingPeriod    = 30 * time.Second
	maxClientMsg  = 4096
	clientBufSize = 256
)

// Broadcaster is the read interface used by other packages.
type Broadcaster interface {
	Broadcast(orgID int64, topic, eventType string, payload any)
	BroadcastToTopic(orgID int64, topic, eventType string, payload any)
}

// Message is the JSON shape pushed to clients.
type Message struct {
	Type      string    `json:"type"`
	Topic     string    `json:"topic"`
	Timestamp time.Time `json:"timestamp"`
	Payload   any       `json:"payload"`
}

// clientCmd is the JSON shape received from clients.
type clientCmd struct {
	Type  string `json:"type"` // subscribe | unsubscribe
	Topic string `json:"topic"`
}

// Client is one WebSocket connection.
type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	orgID  int64
	userID int64
	role   string
	send   chan Message
	subs   map[string]struct{}
	mu     sync.Mutex
}

// Hub is the central registry, sharded by org.
type Hub struct {
	mu       sync.RWMutex
	clients  map[int64]map[*Client]struct{} // orgID -> set
	upgrader websocket.Upgrader
	logger   *slog.Logger
}

// NewHub constructs an empty hub.
func NewHub(logger *slog.Logger, allowedOrigins []string) *Hub {
	originAllow := buildOriginCheck(allowedOrigins)
	return &Hub{
		clients: make(map[int64]map[*Client]struct{}),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 4096,
			CheckOrigin:     originAllow,
		},
		logger: logger,
	}
}

func buildOriginCheck(allowed []string) func(r *http.Request) bool {
	check := BuildOriginAllow(allowed)
	return func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true // non-browser client (e.g. node agent or curl)
		}
		return check(r, origin)
	}
}

// BuildOriginAllow returns a predicate that accepts an Origin string when:
//   - explicit allow list contains it (exact match), OR
//   - allow list is empty AND the origin host is loopback / RFC1918 / link-local
//     (so any developer on the LAN can use the dashboard out of the box), OR
//   - allow list contains "*" (wildcard, allow everything).
func BuildOriginAllow(allowed []string) func(r *http.Request, origin string) bool {
	allowMap := make(map[string]struct{}, len(allowed))
	wildcard := false
	for _, o := range allowed {
		if o == "*" {
			wildcard = true
		}
		allowMap[o] = struct{}{}
	}
	return func(_ *http.Request, origin string) bool {
		if wildcard {
			return true
		}
		if _, ok := allowMap[origin]; ok {
			return true
		}
		if len(allowed) > 0 {
			return false
		}
		return isLocalOrLANOrigin(origin)
	}
}

func isLocalOrLANOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return false
	}
	host := u.Hostname()
	if host == "localhost" || strings.HasSuffix(host, ".local") {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() {
		return true
	}
	return false
}

// HandleHTTP upgrades an HTTP request to a WebSocket and registers the client.
func (h *Hub) HandleHTTP(w http.ResponseWriter, r *http.Request, orgID, userID int64, role string) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Warn("ws upgrade failed", slog.Any("err", err))
		return
	}
	c := &Client{
		hub:    h,
		conn:   conn,
		orgID:  orgID,
		userID: userID,
		role:   role,
		send:   make(chan Message, clientBufSize),
		subs:   make(map[string]struct{}),
	}
	h.register(c)

	go c.writeLoop()
	go c.readLoop()
}

func (h *Hub) register(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[c.orgID]; !ok {
		h.clients[c.orgID] = make(map[*Client]struct{})
	}
	h.clients[c.orgID][c] = struct{}{}
}

func (h *Hub) unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if set, ok := h.clients[c.orgID]; ok {
		delete(set, c)
		if len(set) == 0 {
			delete(h.clients, c.orgID)
		}
	}
	close(c.send)
}

// Broadcast sends to every client in the org regardless of subscription.
func (h *Hub) Broadcast(orgID int64, topic, eventType string, payload any) {
	h.dispatch(orgID, topic, eventType, payload, false)
}

// BroadcastToTopic sends only to clients subscribed to the given topic.
func (h *Hub) BroadcastToTopic(orgID int64, topic, eventType string, payload any) {
	h.dispatch(orgID, topic, eventType, payload, true)
}

func (h *Hub) dispatch(orgID int64, topic, eventType string, payload any, requireSub bool) {
	msg := Message{
		Type:      eventType,
		Topic:     topic,
		Timestamp: time.Now().UTC(),
		Payload:   payload,
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	set, ok := h.clients[orgID]
	if !ok {
		return
	}
	for c := range set {
		if requireSub {
			c.mu.Lock()
			_, subbed := c.subs[topic]
			c.mu.Unlock()
			if !subbed {
				continue
			}
		}
		select {
		case c.send <- msg:
		default:
			// buffer full -- drop to avoid head-of-line blocking
		}
	}
}

func (c *Client) writeLoop() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			data, err := json.Marshal(msg)
			if err != nil {
				continue
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Client) readLoop() {
	defer func() {
		c.hub.unregister(c)
	}()
	c.conn.SetReadLimit(maxClientMsg)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		var cmd clientCmd
		if err := json.Unmarshal(data, &cmd); err != nil {
			continue
		}
		switch cmd.Type {
		case "subscribe":
			c.mu.Lock()
			c.subs[cmd.Topic] = struct{}{}
			c.mu.Unlock()
		case "unsubscribe":
			c.mu.Lock()
			delete(c.subs, cmd.Topic)
			c.mu.Unlock()
		}
	}
}
