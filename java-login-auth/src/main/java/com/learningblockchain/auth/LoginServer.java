package com.learningblockchain.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Optional;

public class LoginServer {
    private final HttpServer server;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final AuthService authService;

    public LoginServer(int port, AuthService authService) throws IOException {
        this.server = HttpServer.create(new InetSocketAddress(port), 0);
        this.authService = authService;
        this.server.createContext("/login", this::handleLogin);
    }

    public void start() {
        server.start();
    }

    private void handleLogin(HttpExchange exchange) throws IOException {
        if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            writeJson(exchange, 405, Map.of("message", "Method not allowed"));
            return;
        }

        LoginRequest request;
        try (InputStream body = exchange.getRequestBody()) {
            request = objectMapper.readValue(body, LoginRequest.class);
        } catch (Exception exception) {
            writeJson(exchange, 400, Map.of("message", "Invalid request body"));
            return;
        }

        Optional<String> token = authService.login(request.username(), request.password());
        if (token.isPresent()) {
            writeJson(exchange, 200, new LoginResponse(token.get(), "Login successful"));
            return;
        }

        writeJson(exchange, 401, Map.of("message", "Invalid credentials"));
    }

    private void writeJson(HttpExchange exchange, int statusCode, Object payload) throws IOException {
        byte[] response = objectMapper.writeValueAsString(payload).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(statusCode, response.length);
        exchange.getResponseBody().write(response);
        exchange.close();
    }
}
