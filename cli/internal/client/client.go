// Package client is a thin HTTP client for the core REST API with auto JWT refresh.
package client

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Client wraps the core REST API.
type Client struct {
	BaseURL      string
	HTTP         *http.Client
	mu           sync.Mutex
	accessToken  string
	refreshToken string
	role         string
	userID       int64
	orgID        int64
}

// New constructs a Client.
func New(baseURL string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		HTTP:    &http.Client{Timeout: 30 * time.Second},
	}
}

// Tokens returns current access/refresh tokens.
func (c *Client) Tokens() (access, refresh string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.accessToken, c.refreshToken
}

// SetTokens sets tokens (e.g. on Login).
func (c *Client) SetTokens(access, refresh string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.accessToken = access
	c.refreshToken = refresh
}

// Role returns the cached role.
func (c *Client) Role() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.role
}

// IsAuthed reports whether we have an access token.
func (c *Client) IsAuthed() bool {
	a, _ := c.Tokens()
	return a != ""
}

// Login authenticates and stores tokens.
func (c *Client) Login(email, password string) error {
	body := map[string]string{"email": email, "password": password}
	var out struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		Role         string `json:"role"`
		UserID       int64  `json:"user_id"`
		OrgID        int64  `json:"org_id"`
	}
	if err := c.do(http.MethodPost, "/api/v1/auth/login", body, &out, false); err != nil {
		return err
	}
	c.mu.Lock()
	c.accessToken = out.AccessToken
	c.refreshToken = out.RefreshToken
	c.role = out.Role
	c.userID = out.UserID
	c.orgID = out.OrgID
	c.mu.Unlock()
	return nil
}

// Refresh exchanges the refresh token.
func (c *Client) Refresh() error {
	c.mu.Lock()
	rt := c.refreshToken
	c.mu.Unlock()
	if rt == "" {
		return errors.New("no refresh token")
	}
	var out struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.do(http.MethodPost, "/api/v1/auth/refresh", map[string]string{"refresh_token": rt}, &out, false); err != nil {
		return err
	}
	c.mu.Lock()
	c.accessToken = out.AccessToken
	c.refreshToken = out.RefreshToken
	c.mu.Unlock()
	return nil
}

// Get does a GET request to the core.
func (c *Client) Get(path string, out any) error { return c.do(http.MethodGet, path, nil, out, true) }

// Post does a POST request.
func (c *Client) Post(path string, in, out any) error {
	return c.do(http.MethodPost, path, in, out, true)
}

// Patch does a PATCH request.
func (c *Client) Patch(path string, in, out any) error {
	return c.do(http.MethodPatch, path, in, out, true)
}

// Delete does a DELETE request.
func (c *Client) Delete(path string, out any) error {
	return c.do(http.MethodDelete, path, nil, out, true)
}

// GetWithQuery appends query params and GETs.
func (c *Client) GetWithQuery(path string, q url.Values, out any) error {
	if q != nil && len(q) > 0 {
		path = path + "?" + q.Encode()
	}
	return c.Get(path, out)
}

func (c *Client) do(method, path string, in, out any, retry bool) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.BaseURL+path, body)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	c.mu.Lock()
	if c.accessToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.accessToken)
	}
	c.mu.Unlock()

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode == http.StatusUnauthorized && retry {
		if err := c.Refresh(); err == nil {
			return c.do(method, path, in, out, false)
		}
	}
	if resp.StatusCode >= 300 {
		return fmt.Errorf("%s %s: HTTP %d: %s", method, path, resp.StatusCode, string(respBody))
	}
	if out != nil && len(respBody) > 0 {
		return json.Unmarshal(respBody, out)
	}
	return nil
}
