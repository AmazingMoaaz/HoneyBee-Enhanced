// Package protocol implements the HoneyBee-Enhanced wire protocol (v4).
//
// Wire format: 4-byte big-endian length prefix followed by JSON body.
// All messages are wrapped in an Envelope.
package protocol

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"time"
)

const (
	// ProtocolVersion is the current protocol version.
	ProtocolVersion = 4

	// MaxMessageSize is the maximum allowed JSON body size (10 MiB).
	MaxMessageSize = 10 * 1024 * 1024

	// ReadTimeout is the per-message read deadline.
	ReadTimeout = 120 * time.Second

	// WriteTimeout is the per-message write deadline.
	WriteTimeout = 30 * time.Second
)

// Envelope is the universal wrapper for every message sent on the wire.
type Envelope struct {
	Version   int             `json:"version"`
	Type      string          `json:"type"`
	Timestamp time.Time       `json:"timestamp"`
	Payload   json.RawMessage `json:"payload"`
}

// ErrMessageTooLarge is returned when an incoming frame exceeds MaxMessageSize.
var ErrMessageTooLarge = errors.New("protocol: message exceeds maximum size")

// ReadMessage reads exactly one length-prefixed envelope from conn.
// A read deadline of ReadTimeout is applied if conn is a net.Conn.
func ReadMessage(conn net.Conn) (*Envelope, error) {
	if err := conn.SetReadDeadline(time.Now().Add(ReadTimeout)); err != nil {
		return nil, fmt.Errorf("set read deadline: %w", err)
	}

	var lenBuf [4]byte
	if _, err := io.ReadFull(conn, lenBuf[:]); err != nil {
		return nil, err
	}
	size := binary.BigEndian.Uint32(lenBuf[:])
	if size == 0 {
		return nil, errors.New("protocol: zero-length frame")
	}
	if size > MaxMessageSize {
		return nil, ErrMessageTooLarge
	}

	body := make([]byte, size)
	if _, err := io.ReadFull(conn, body); err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	var env Envelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("unmarshal envelope: %w", err)
	}
	return &env, nil
}

// SendMessage marshals payload, wraps it in an envelope, and writes it to conn.
func SendMessage(conn net.Conn, msgType string, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	env := Envelope{
		Version:   ProtocolVersion,
		Type:      msgType,
		Timestamp: time.Now().UTC(),
		Payload:   raw,
	}

	body, err := json.Marshal(env)
	if err != nil {
		return fmt.Errorf("marshal envelope: %w", err)
	}
	if len(body) > MaxMessageSize {
		return ErrMessageTooLarge
	}

	if err := conn.SetWriteDeadline(time.Now().Add(WriteTimeout)); err != nil {
		return fmt.Errorf("set write deadline: %w", err)
	}

	var lenBuf [4]byte
	binary.BigEndian.PutUint32(lenBuf[:], uint32(len(body)))

	if _, err := conn.Write(lenBuf[:]); err != nil {
		return fmt.Errorf("write length: %w", err)
	}
	if _, err := conn.Write(body); err != nil {
		return fmt.Errorf("write body: %w", err)
	}
	return nil
}

// DecodePayload unmarshals env.Payload into out.
func DecodePayload(env *Envelope, out any) error {
	return json.Unmarshal(env.Payload, out)
}
