package com.learningblockchain.auth;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Optional;

public class InMemoryUserRepository {
    private final Map<String, StoredUser> users;

    public InMemoryUserRepository() {
        byte[] salt = "learning-blockchain-salt".getBytes(StandardCharsets.UTF_8);
        String hash = PasswordHasher.hash("admin123", salt);
        this.users = Map.of("admin", new StoredUser("admin", hash, salt));
    }

    public Optional<StoredUser> findByUsername(String username) {
        return Optional.ofNullable(users.get(username));
    }

    public record StoredUser(String username, String passwordHash, byte[] salt) {
    }
}
