package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/azhry/nala-trace/backend/internal/hooks"
)

func main() {
	manifestPath := flag.String("manifest", "hooks.json", "path to the hooks manifest")
	flag.Parse()

	manifest, err := hooks.LoadFile(*manifestPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	fmt.Printf("valid hooks manifest: version=%d events=%d\n", manifest.Version, len(manifest.Hooks))
}
