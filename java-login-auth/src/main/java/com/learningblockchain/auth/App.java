package com.learningblockchain.auth;

public class App {
    public static void main(String[] args) throws Exception {
        int port = 8080;
        LoginServer server = new LoginServer(port, new AuthService(new InMemoryUserRepository()));
        server.start();
        System.out.println("Login auth server running on http://localhost:" + port);
    }
}
