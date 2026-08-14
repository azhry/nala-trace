package server

import "net/http"

type healthDependency struct {
	Status string `json:"status"`
}

type healthResponse struct {
	Status       string                      `json:"status"`
	Dependencies map[string]healthDependency `json:"dependencies"`
}

func HealthRoute() Route {
	response := healthResponse{
		Status:       "ok",
		Dependencies: map[string]healthDependency{},
	}

	return Route{
		Pattern: "/healthz",
		Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			WriteJSON(w, http.StatusOK, response)
		}),
	}
}
