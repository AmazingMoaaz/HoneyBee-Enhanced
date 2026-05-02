// Package config loads core server configuration from YAML + environment.
package config

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

// Config is the root configuration.
type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Database DatabaseConfig `yaml:"database"`
	TLS      TLSConfig      `yaml:"tls"`
	JWT      JWTConfig      `yaml:"jwt"`
	PotStore PotStoreConfig `yaml:"potstore"`
	Node     NodeRelease    `yaml:"node"`
	Log      LogConfig      `yaml:"log"`
}

// ServerConfig holds HTTP + node TCP listener settings.
type ServerConfig struct {
	HTTPAddr       string   `yaml:"http_addr"`
	NodeAddr       string   `yaml:"node_addr"`
	// NodePublicAddr is the address node agents use to reach the TCP server.
	// If empty the install script derives it from the HTTP request host + node port.
	NodePublicAddr string   `yaml:"node_public_addr"`
	AllowedOrigins []string `yaml:"allowed_origins"`
}

// DatabaseConfig holds MySQL connection details.
type DatabaseConfig struct {
	DSN     string `yaml:"dsn"`
	MaxOpen int    `yaml:"max_open"`
	MaxIdle int    `yaml:"max_idle"`
}

// TLSConfig optionally enables TLS on the node TCP listener.
type TLSConfig struct {
	Enabled  bool   `yaml:"enabled"`
	CertFile string `yaml:"cert_file"`
	KeyFile  string `yaml:"key_file"`
}

// JWTConfig configures JWT signing.
type JWTConfig struct {
	Secret     string        `yaml:"secret"`
	AccessTTL  time.Duration `yaml:"access_ttl"`
	RefreshTTL time.Duration `yaml:"refresh_ttl"`
}

// PotStoreConfig configures the potstore catalog client.
type PotStoreConfig struct {
	RepoURL      string        `yaml:"repo_url"`
	SyncInterval time.Duration `yaml:"sync_interval"`
}

// NodeRelease points to the node-agent binary distribution.
type NodeRelease struct {
	GitHubRepo       string `yaml:"github_repo"`
	GitHubReleaseTag string `yaml:"github_release_tag"`
	GitHubToken      string `yaml:"github_token"` // optional – for private repos
}

// LogConfig configures logging.
type LogConfig struct {
	Level string `yaml:"level"`
}

// Load reads YAML from path and applies defaults / env overrides.
func Load(path string) (*Config, error) {
	cfg := defaultConfig()
	if path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read config: %w", err)
		}
		if err := yaml.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("parse yaml: %w", err)
		}
	}
	applyEnv(cfg)
	return cfg, nil
}

func defaultConfig() *Config {
	return &Config{
		Server: ServerConfig{
			HTTPAddr:       "0.0.0.0:5100",
			NodeAddr:       "0.0.0.0:9001",
			AllowedOrigins: []string{"http://localhost:5173"},
		},
		Database: DatabaseConfig{
			DSN:     "root:password@tcp(127.0.0.1:3306)/honeybee_enhanced?parseTime=true&charset=utf8mb4",
			MaxOpen: 25,
			MaxIdle: 5,
		},
		JWT: JWTConfig{
			Secret:     "change-me",
			AccessTTL:  15 * time.Minute,
			RefreshTTL: 7 * 24 * time.Hour,
		},
		PotStore: PotStoreConfig{
			RepoURL:      "https://raw.githubusercontent.com/H0neyBe/honeybee_potstore/main/potstore.json",
			SyncInterval: time.Hour,
		},
		Node: NodeRelease{
			GitHubRepo:       "AmazingMoaaz/HoneyBee-Enhanced",
			GitHubReleaseTag: "latest",
		},
		Log: LogConfig{Level: "info"},
	}
}

func applyEnv(cfg *Config) {
	if v := os.Getenv("DB_DSN"); v != "" {
		cfg.Database.DSN = v
	}
	if v := os.Getenv("JWT_SECRET"); v != "" {
		cfg.JWT.Secret = v
	}
	if v := os.Getenv("HTTP_ADDR"); v != "" {
		cfg.Server.HTTPAddr = v
	}
	if v := os.Getenv("NODE_ADDR"); v != "" {
		cfg.Server.NodeAddr = v
	}
	if v := os.Getenv("LOG_LEVEL"); v != "" {
		cfg.Log.Level = v
	}
}
