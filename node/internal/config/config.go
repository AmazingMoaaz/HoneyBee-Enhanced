// Package config loads node-agent configuration from YAML + env.
package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

// Config is the node-agent configuration.
type Config struct {
	Node struct {
		Name    string `yaml:"name"`
		DataDir string `yaml:"data_dir"`
	} `yaml:"node"`
	Server struct {
		Address            string `yaml:"address"`
		Token              string `yaml:"token"`
		TLS                bool   `yaml:"tls"`
		InsecureSkipVerify bool   `yaml:"insecure_skip_verify"`
	} `yaml:"server"`
	EventFwd struct {
		Listen string `yaml:"listen"`
	} `yaml:"eventfwd"`
	Session struct {
		CowrieTTYDir string `yaml:"cowrie_tty_dir"`
	} `yaml:"session"`
	Log struct {
		Level string `yaml:"level"`
	} `yaml:"log"`
}

// Load parses YAML at path, applying env overrides.
func Load(path string) (*Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	c := &Config{}
	if err := yaml.Unmarshal(b, c); err != nil {
		return nil, err
	}
	if c.Node.DataDir == "" {
		c.Node.DataDir = "./node_data"
	}
	if v := os.Getenv("HB_SERVER_ADDR"); v != "" {
		c.Server.Address = v
	}
	if v := os.Getenv("HB_NODE_TOKEN"); v != "" {
		c.Server.Token = v
	}
	if v := os.Getenv("HB_NODE_NAME"); v != "" {
		c.Node.Name = v
	}
	if c.EventFwd.Listen == "" {
		c.EventFwd.Listen = "127.0.0.1:9100"
	}
	if c.Log.Level == "" {
		c.Log.Level = "info"
	}
	return c, nil
}
