package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// profile names one local executor and the Slate identity it must authenticate
// as. It never holds the credential itself, only the name of the environment
// variable that carries it.
type profile struct {
	AgentID  string   `json:"agentId"`
	TokenEnv string   `json:"tokenEnv"`
	Command  []string `json:"command"`
}

type watcherConfig struct {
	Profiles map[string]profile `json:"profiles"`
}

// configPath resolves SLATE_CONFIG, then the operating system's user
// configuration directory.
func configPath() (string, error) {
	if override := strings.TrimSpace(os.Getenv("SLATE_CONFIG")); override != "" {
		return override, nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("no user configuration directory: %w", err)
	}
	return filepath.Join(dir, "slate", "config.json"), nil
}

// loadProfile reads one named profile and rejects anything it does not
// understand, so a typo fails at startup rather than silently changing which
// executor runs.
func loadProfile(name string) (profile, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return profile{}, errors.New("--profile is required")
	}
	path, err := configPath()
	if err != nil {
		return profile{}, err
	}
	raw, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return profile{}, fmt.Errorf("no profile configuration at %s", path)
		}
		return profile{}, err
	}
	defer raw.Close()
	decoder := json.NewDecoder(raw)
	decoder.DisallowUnknownFields()
	var config watcherConfig
	if err := decoder.Decode(&config); err != nil {
		return profile{}, fmt.Errorf("%s is not valid profile configuration: %w", path, err)
	}
	// Two concatenated documents would otherwise leave the watcher silently
	// running the first one, which is the opposite of failing loudly at startup.
	if err := decoder.Decode(new(json.RawMessage)); err != io.EOF {
		return profile{}, fmt.Errorf("%s has content after the configuration object", path)
	}
	selected, ok := config.Profiles[name]
	if !ok {
		return profile{}, fmt.Errorf("no profile named %q in %s; configured profiles: %s", name, path, profileNames(config))
	}
	if err := selected.validate(name); err != nil {
		return profile{}, err
	}
	return selected, nil
}

func profileNames(config watcherConfig) string {
	if len(config.Profiles) == 0 {
		return "none"
	}
	names := make([]string, 0, len(config.Profiles))
	for name := range config.Profiles {
		names = append(names, name)
	}
	sort.Strings(names)
	return strings.Join(names, ", ")
}

func (p profile) validate(name string) error {
	if !validUUID(strings.TrimSpace(p.AgentID)) {
		return fmt.Errorf("profile %q needs agentId to be the agent's Slate ID", name)
	}
	if strings.TrimSpace(p.TokenEnv) == "" {
		return fmt.Errorf("profile %q needs tokenEnv, the name of the variable holding its Slate token", name)
	}
	if strings.HasPrefix(strings.TrimSpace(p.TokenEnv), "slate_") {
		// A token pasted where its variable name belongs would otherwise be
		// written to the registry and printed in errors.
		return fmt.Errorf("profile %q has a token in tokenEnv; store the variable name instead", name)
	}
	if len(p.Command) == 0 || strings.TrimSpace(p.Command[0]) == "" {
		return fmt.Errorf("profile %q needs a command array, for example [\"codex\", \"exec\", \"-\"]", name)
	}
	return nil
}

// token reads the credential named by the profile. The value is never stored.
func (p profile) token() (string, error) {
	value := strings.TrimSpace(os.Getenv(strings.TrimSpace(p.TokenEnv)))
	if value == "" {
		return "", fmt.Errorf("%s is empty; export the agent's Slate token there", strings.TrimSpace(p.TokenEnv))
	}
	return value, nil
}
