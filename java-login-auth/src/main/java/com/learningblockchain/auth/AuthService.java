package com.learningblockchain.auth;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.Optional;

public class AuthService {
    private final InMemoryUserRepository userRepository;

    public AuthService(InMemoryUserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public Optional<String> login(String username, String password) {
        if (isBlank(username) || isBlank(password)) {
            return Optional.empty();
        }

        return userRepository.findByUsername(username)
            .filter(user -> PasswordHasher.verify(password, user.passwordHash(), user.salt()))
            .map(user -> generateToken(username));
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private String generateToken(String username) {
        String payload = username + ":" + Instant.now().toEpochMilli();
        return Base64.getUrlEncoder().withoutPadding()
            .encodeToString(payload.getBytes(StandardCharsets.UTF_8));
    }
}
