package com.learningblockchain.auth;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AuthServiceTest {
    private AuthService authService;

    @BeforeEach
    void setUp() {
        authService = new AuthService(new InMemoryUserRepository());
    }

    @Test
    void loginSucceedsWithValidCredentials() {
        assertTrue(authService.login("admin", "admin123").isPresent());
    }

    @Test
    void loginFailsWithWrongPassword() {
        assertFalse(authService.login("admin", "wrong-password").isPresent());
    }

    @Test
    void loginFailsForUnknownUser() {
        assertFalse(authService.login("unknown", "admin123").isPresent());
    }
}
