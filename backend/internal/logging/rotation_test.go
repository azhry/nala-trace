package logging

import (
	"bytes"
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNewWriterUsesOverrideAndRotationDefaults(t *testing.T) {
	override := filepath.Join(t.TempDir(), "custom.log")
	t.Setenv("NALA_LOG_FILE", override)

	writer := NewWriter(filepath.Join(t.TempDir(), "default.log"))
	if writer.Filename != override {
		t.Fatalf("Filename = %q, want %q", writer.Filename, override)
	}
	if writer.MaxSize != 10 || writer.MaxBackups != 5 || writer.MaxAge != 30 || !writer.Compress {
		t.Fatalf("unexpected rotation settings: %+v", writer)
	}
}

func TestNewWriterUsesDefaultPathWhenOverrideBlank(t *testing.T) {
	t.Setenv("NALA_LOG_FILE", " ")
	path := filepath.Join(t.TempDir(), "service.log")

	writer := NewWriter(path)
	if writer.Filename != path {
		t.Fatalf("Filename = %q, want %q", writer.Filename, path)
	}
}

func TestRotatingWriterCreatesCompressedBackupOnDisk(t *testing.T) {
	path := filepath.Join(t.TempDir(), "service.log")
	writer := newRotatingWriter(path, 1)
	first := bytes.Repeat([]byte("x"), 1<<20)
	const sentinel = "azh520-rotation-sentinel"
	copy(first, sentinel)

	if n, err := writer.Write(first); err != nil || n != len(first) {
		t.Fatalf("write initial log: n=%d err=%v", n, err)
	}
	if n, err := writer.Write([]byte("current log\n")); err != nil || n != len("current log\n") {
		t.Fatalf("write after rotation threshold: n=%d err=%v", n, err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close rotating writer: %v", err)
	}

	var backups []string
	var err error
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		backups, err = filepath.Glob(filepath.Join(filepath.Dir(path), "service-*.log.gz"))
		if err != nil {
			t.Fatalf("find rotated log: %v", err)
		}
		if len(backups) > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(backups) != 1 {
		t.Fatalf("rotated logs = %v, want one compressed timestamped backup", backups)
	}
	file, err := os.Open(backups[0])
	if err != nil {
		t.Fatalf("open rotated log: %v", err)
	}
	defer file.Close()

	reader, err := gzip.NewReader(file)
	if err != nil {
		t.Fatalf("open compressed log: %v", err)
	}
	rotated, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read compressed log: %v", err)
	}
	if err := reader.Close(); err != nil {
		t.Fatalf("close compressed log: %v", err)
	}
	if !bytes.Equal(rotated, first) {
		t.Fatalf("rotated log length = %d, want %d", len(rotated), len(first))
	}
	if !bytes.Contains(rotated, []byte(sentinel)) {
		t.Fatalf("rotated log does not contain sentinel %q", sentinel)
	}

	current, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read current log: %v", err)
	}
	if string(current) != "current log\n" {
		t.Fatalf("current log = %q, want %q", current, "current log\n")
	}
}
