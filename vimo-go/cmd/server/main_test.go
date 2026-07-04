package main

import (
	"testing"

	"mintal-vimo/vimo-go/internal/config"
)

func TestValidateRuntimeSecurityAllowsLocalLoopbackWithoutToken(t *testing.T) {
	err := validateRuntimeSecurity(&config.App{
		Env:      "local",
		HTTPHost: "127.0.0.1",
	})
	if err != nil {
		t.Fatalf("validateRuntimeSecurity() error = %v", err)
	}
}

func TestValidateRuntimeSecurityRequiresTokenForExposedHost(t *testing.T) {
	err := validateRuntimeSecurity(&config.App{
		Env:      "local",
		HTTPHost: "0.0.0.0",
	})
	if err == nil {
		t.Fatal("validateRuntimeSecurity() error = nil, want exposed host error")
	}
}

func TestValidateRuntimeSecurityRequiresTokenForNonLocalEnv(t *testing.T) {
	err := validateRuntimeSecurity(&config.App{
		Env:      "production",
		HTTPHost: "127.0.0.1",
	})
	if err == nil {
		t.Fatal("validateRuntimeSecurity() error = nil, want non-local token error")
	}
}

func TestValidateRuntimeSecurityAcceptsConfiguredToken(t *testing.T) {
	err := validateRuntimeSecurity(&config.App{
		Env:             "production",
		HTTPHost:        "0.0.0.0",
		RequireAPIToken: true,
		APIToken:        "secret",
	})
	if err != nil {
		t.Fatalf("validateRuntimeSecurity() error = %v", err)
	}
}
