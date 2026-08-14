package server

import "net/http"

type healthDependency struct {
	Status string `json:"status"`
}

type healthResponse struct {
	Status       string                      `json:"status"`
	Dependencies map[string]healthDependency `json:"dependencies"`
}

var healthDependencyNames = []string{
	"casdoor",
	"vault",
	"postgresql",
	"mongodb",
	"redis",
	"kafka",
}

func siblingHealthDependencies() map[string]healthDependency {
	dependencies := make(map[string]healthDependency, len(healthDependencyNames))
	for _, name := range healthDependencyNames {
		dependencies[name] = healthDependency{Status: "not_configured"}
	}
	return dependencies
}

func HealthRoute() Route {
	response := healthResponse{
		Status:       "ok",
		Dependencies: siblingHealthDependencies(),
	}

	return Route{
		Pattern: "/healthz",
		Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			WriteJSON(w, http.StatusOK, response)
		}),
	}
}
