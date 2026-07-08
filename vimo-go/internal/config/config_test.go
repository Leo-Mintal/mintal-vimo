package config

import (
	"os"
	"testing"
)

func TestLoadDatabaseConfigDefaultsToMemoryEvenWithMySQLDSN(t *testing.T) {
	t.Setenv("DB_DRIVER", "")
	t.Setenv("MYSQL_DSN", "vimo:vimo@tcp(127.0.0.1:3306)/vimo?parseTime=true")

	cfg := loadDatabaseConfig()

	if cfg.Driver != "memory" {
		t.Fatalf("Driver = %q, want memory", cfg.Driver)
	}
	if cfg.DSN == "" {
		t.Fatal("DSN should still be preserved for explicit mysql opt-in")
	}
}

func TestLoadDatabaseConfigUsesMySQLOnlyWhenExplicit(t *testing.T) {
	t.Setenv("DB_DRIVER", "mysql")
	t.Setenv("MYSQL_DSN", "vimo:vimo@tcp(127.0.0.1:3306)/vimo?parseTime=true")

	cfg := loadDatabaseConfig()

	if cfg.Driver != "mysql" {
		t.Fatalf("Driver = %q, want mysql", cfg.Driver)
	}
}

func TestEnvSecurityDefaults(t *testing.T) {
	t.Setenv("APP_ENV", "")
	t.Setenv("HTTP_HOST", "")
	t.Setenv("ALLOWED_ORIGINS", "")
	t.Setenv("REQUIRE_API_TOKEN", "")
	t.Setenv("API_TOKEN", "")
	t.Setenv("ACTIVE_MODEL_CONFIG", "")

	cfg, err := Load(t.TempDir())
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.HTTPHost != "127.0.0.1" {
		t.Fatalf("HTTPHost = %q, want 127.0.0.1", cfg.HTTPHost)
	}
	if cfg.RequireAPIToken {
		t.Fatal("RequireAPIToken = true, want false by default for local")
	}
	if len(cfg.AllowedOrigins) != 2 {
		t.Fatalf("AllowedOrigins len = %d, want 2", len(cfg.AllowedOrigins))
	}
}

func TestEnvSecurityOverrides(t *testing.T) {
	t.Setenv("HTTP_HOST", "0.0.0.0")
	t.Setenv("ALLOWED_ORIGINS", "https://app.example.com, http://localhost:5173 ")
	t.Setenv("REQUIRE_API_TOKEN", "true")
	t.Setenv("API_TOKEN", "secret")
	t.Setenv("ACTIVE_MODEL_CONFIG", "")

	cfg, err := Load(t.TempDir())
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.HTTPHost != "0.0.0.0" {
		t.Fatalf("HTTPHost = %q, want 0.0.0.0", cfg.HTTPHost)
	}
	if !cfg.RequireAPIToken {
		t.Fatal("RequireAPIToken = false, want true")
	}
	if cfg.APIToken != "secret" {
		t.Fatalf("APIToken = %q, want secret", cfg.APIToken)
	}
	if len(cfg.AllowedOrigins) != 2 || cfg.AllowedOrigins[0] != "https://app.example.com" {
		t.Fatalf("AllowedOrigins = %#v", cfg.AllowedOrigins)
	}
}

func TestLoadReturnsErrorForExplicitMissingModelConfig(t *testing.T) {
	t.Setenv("ACTIVE_MODEL_CONFIG", "/path/that/does/not/exist")

	_, err := Load(t.TempDir())

	if err == nil {
		t.Fatal("Load() error = nil, want explicit model config error")
	}
}

func TestLoadModelConfigReadsSupportsThinking(t *testing.T) {
	path := writeTempFile(t, `active_provider: thinker

providers:
  thinker:
    type: openai_compatible
    label: Thinker
    description: Reasoning model
    supports_thinking: true
    base_url: http://127.0.0.1:8001
    chat_model: thinker
`)

	cfg, err := LoadModelConfig(path)
	if err != nil {
		t.Fatalf("LoadModelConfig() error = %v", err)
	}
	if !cfg.Providers["thinker"].SupportsThinking {
		t.Fatal("SupportsThinking = false, want true")
	}
}

func writeTempFile(t *testing.T, content string) string {
	t.Helper()
	path := t.TempDir() + "/models.yaml"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write temp file: %v", err)
	}
	return path
}
