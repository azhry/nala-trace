package logging

import (
	"os"
	"strings"

	"gopkg.in/natefinch/lumberjack.v2"
)

const (
	maxSizeMB  = 10
	maxBackups = 5
	maxAgeDays = 30
)

// NewWriter returns a lumberjack writer using NALA_LOG_FILE when set.
func NewWriter(defaultPath string) *lumberjack.Logger {
	filename := defaultPath
	if override := strings.TrimSpace(os.Getenv("NALA_LOG_FILE")); override != "" {
		filename = override
	}
	return newRotatingWriter(filename, maxSizeMB)
}

func newRotatingWriter(filename string, maxSize int) *lumberjack.Logger {
	return &lumberjack.Logger{
		Filename:   filename,
		MaxSize:    maxSize,
		MaxBackups: maxBackups,
		MaxAge:     maxAgeDays,
		Compress:   true,
	}
}
