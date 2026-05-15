// Package config loads core server configuration from JSON or YAML.
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Duration wraps time.Duration so JSON accepts human-readable strings ("15m", "168h").
type Duration struct{ time.Duration }

func (d Duration) MarshalJSON() ([]byte, error) {
	return json.Marshal(d.String())
}

func (d *Duration) UnmarshalJSON(b []byte) error {
	// try quoted string first: "15m"
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		v, err := time.ParseDuration(s)
		if err != nil {
			return fmt.Errorf("invalid duration %q: %w", s, err)
		}
		d.Duration = v
		return nil
	}
	// fall back to raw nanoseconds
	var ns int64
	if err := json.Unmarshal(b, &ns); err != nil {
		return err
	}
	d.Duration = time.Duration(ns)
	return nil
}

// Config is the root configuration.
type Config struct {
	Server   ServerConfig   `yaml:"server"   json:"server"`
	Database DatabaseConfig `yaml:"database" json:"database"`
	TLS      TLSConfig      `yaml:"tls"      json:"tls"`
	JWT      JWTConfig      `yaml:"jwt"      json:"jwt"`
	PotStore PotStoreConfig `yaml:"potstore" json:"potstore"`
	Node     NodeRelease    `yaml:"node"     json:"node"`
	Log      LogConfig      `yaml:"log"      json:"log"`
}

// ServerConfig holds HTTP + node TCP listener settings.
type ServerConfig struct {
	HTTPAddr       string   `yaml:"http_addr"       json:"http_addr"`
	NodeAddr       string   `yaml:"node_addr"       json:"node_addr"`
	NodePublicAddr string   `yaml:"node_public_addr" json:"node_public_addr"`
	PublicHTTPAddr string   `yaml:"public_http_addr" json:"public_http_addr"`
	AllowedOrigins []string `yaml:"allowed_origins" json:"allowed_origins"`
}

// DatabaseConfig holds MySQL connection details.
type DatabaseConfig struct {
	DSN     string `yaml:"dsn"      json:"dsn"`
	MaxOpen int    `yaml:"max_open" json:"max_open"`
	MaxIdle int    `yaml:"max_idle" json:"max_idle"`
}

// TLSConfig optionally enables TLS on the node TCP listener.
type TLSConfig struct {
	Enabled  bool   `yaml:"enabled"   json:"enabled"`
	CertFile string `yaml:"cert_file" json:"cert_file"`
	KeyFile  string `yaml:"key_file"  json:"key_file"`
}

// JWTConfig configures JWT signing.
type JWTConfig struct {
	Secret     string   `yaml:"secret"      json:"secret"`
	AccessTTL  Duration `yaml:"access_ttl"  json:"access_ttl"`
	RefreshTTL Duration `yaml:"refresh_ttl" json:"refresh_ttl"`
}

// PotStoreConfig configures the potstore catalog client.
type PotStoreConfig struct {
	RepoURL      string   `yaml:"repo_url"      json:"repo_url"`
	SyncInterval Duration `yaml:"sync_interval" json:"sync_interval"`
}

// NodeRelease points to the node-agent binary distribution.
type NodeRelease struct {
	GitHubRepo       string `yaml:"github_repo"        json:"github_repo"`
	GitHubReleaseTag string `yaml:"github_release_tag" json:"github_release_tag"`
	GitHubToken      string `yaml:"github_token"       json:"github_token"`
}

// LogConfig configures logging.
type LogConfig struct {
	Level string `yaml:"level" json:"level"`
}

// Load reads configs/config.json (or YAML) and returns the config.
// JSON is selected when the path ends in .json, otherwise YAML is assumed.
// After parsing the file, the following environment variables are applied as
// overrides (matching the names used in docker-compose):
//
//	HTTP_ADDR   → server.http_addr
//	NODE_ADDR   → server.node_addr
//	DB_DSN      → database.dsn
//	JWT_SECRET  → jwt.secret
//	LOG_LEVEL   → log.level
func Load(path string) (*Config, error) {
	cfg := defaultConfig()
	if path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read config: %w", err)
		}
		if strings.HasSuffix(path, ".json") {
			if err := json.Unmarshal(data, cfg); err != nil {
				return nil, fmt.Errorf("parse json: %w", err)
			}
		} else {
			if err := yaml.Unmarshal(data, cfg); err != nil {
				return nil, fmt.Errorf("parse yaml: %w", err)
			}
		}
	}
	applyEnvOverrides(cfg)
	return cfg, nil
}

// applyEnvOverrides overlays environment variables on top of the file-based
// config. Only non-empty env values are applied so that unset vars leave the
// file-based (or default) values intact.
func applyEnvOverrides(cfg *Config) {
	if v := os.Getenv("HTTP_ADDR"); v != "" {
		cfg.Server.HTTPAddr = v
	}
	if v := os.Getenv("NODE_ADDR"); v != "" {
		cfg.Server.NodeAddr = v
	}
	if v := os.Getenv("DB_DSN"); v != "" {
		cfg.Database.DSN = v
	}
	if v := os.Getenv("JWT_SECRET"); v != "" {
		cfg.JWT.Secret = v
	}
	if v := os.Getenv("LOG_LEVEL"); v != "" {
		cfg.Log.Level = v
	}
}

func defaultConfig() *Config {
	return &Config{
		Server: ServerConfig{
			HTTPAddr:       "0.0.0.0:5400",
			NodeAddr:       "0.0.0.0:9001",
			AllowedOrigins: nil, // nil = auto-allow loopback + RFC1918 LAN origins
		},
		Database: DatabaseConfig{
			DSN:     "root:password@tcp(127.0.0.1:3306)/honeybee_enhanced?parseTime=true&charset=utf8mb4",
			MaxOpen: 25,
			MaxIdle: 5,
		},
		JWT: JWTConfig{
			Secret:     "change-me",
			AccessTTL:  Duration{15 * time.Minute},
			RefreshTTL: Duration{7 * 24 * time.Hour},
		},
		PotStore: PotStoreConfig{
			RepoURL:      "https://raw.githubusercontent.com/H0neyBe/honeybee_potstore/main/potstore.json",
			SyncInterval: Duration{time.Hour},
		},
		Node: NodeRelease{
			GitHubRepo:       "AmazingMoaaz/HoneyBee-Enhanced",
			GitHubReleaseTag: "latest",
		},
		Log: LogConfig{Level: "info"},
	}
}
