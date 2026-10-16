package com.learningblockchain.auth;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;

public final class PasswordHasher {
    private static final int ITERATIONS = 65_536;
    private static final int KEY_LENGTH = 256;

    private PasswordHasher() {
    }

    public static String hash(String password, byte[] salt) {
        try {
            PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, ITERATIONS, KEY_LENGTH);
            SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            byte[] hashed = factory.generateSecret(spec).getEncoded();
            return Base64.getEncoder().encodeToString(hashed);
        } catch (Exception exception) {
            throw new IllegalStateException("Unable to hash password", exception);
        }
    }

    public static boolean verify(String plainPassword, String expectedHash, byte[] salt) {
        String actualHash = hash(plainPassword, salt);
        return MessageDigest.isEqual(
            expectedHash.getBytes(StandardCharsets.UTF_8),
            actualHash.getBytes(StandardCharsets.UTF_8)
        );
    }
}
