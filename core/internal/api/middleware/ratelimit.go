package middleware

import (
	"net/http"
	"strings"
	"sync"
	"time"
)

// RateLimiter is a per-IP sliding window limiter.
type RateLimiter struct {
	mu     sync.Mutex
	hits   map[string][]time.Time
	max    int
	window time.Duration
}

// NewRateLimiter constructs a limiter (e.g., 20 req / min).
func NewRateLimiter(max int, window time.Duration) *RateLimiter {
	rl := &RateLimiter{
		hits:   make(map[string][]time.Time),
		max:    max,
		window: window,
	}
	go rl.gcLoop()
	return rl
}

func (rl *RateLimiter) gcLoop() {
	t := time.NewTicker(rl.window)
	defer t.Stop()
	for range t.C {
		rl.mu.Lock()
		cutoff := time.Now().Add(-rl.window)
		for k, ts := range rl.hits {
			pruned := ts[:0]
			for _, x := range ts {
				if x.After(cutoff) {
					pruned = append(pruned, x)
				}
			}
			if len(pruned) == 0 {
				delete(rl.hits, k)
			} else {
				rl.hits[k] = pruned
			}
		}
		rl.mu.Unlock()
	}
}

// Middleware returns the HTTP middleware handler.
func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		now := time.Now()
		cutoff := now.Add(-rl.window)
		rl.mu.Lock()
		ts := rl.hits[ip]
		pruned := ts[:0]
		for _, x := range ts {
			if x.After(cutoff) {
				pruned = append(pruned, x)
			}
		}
		if len(pruned) >= rl.max {
			rl.hits[ip] = pruned
			rl.mu.Unlock()
			w.Header().Set("Retry-After", "60")
			http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
			return
		}
		pruned = append(pruned, now)
		rl.hits[ip] = pruned
		rl.mu.Unlock()
		next.ServeHTTP(w, r)
	})
}

func clientIP(r *http.Request) string {
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		if i := strings.Index(v, ","); i >= 0 {
			return strings.TrimSpace(v[:i])
		}
		return strings.TrimSpace(v)
	}
	if v := r.Header.Get("X-Real-IP"); v != "" {
		return v
	}
	host := r.RemoteAddr
	if i := strings.LastIndex(host, ":"); i >= 0 {
		host = host[:i]
	}
	return host
}
