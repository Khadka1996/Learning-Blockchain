# Java Backend Login Auth

Minimal Java backend login authentication service with a `/login` endpoint.

## Default credentials

- `username`: `admin`
- `password`: `admin123`

## Run

```bash
cd /home/runner/work/Learning-Blockchain/Learning-Blockchain/java-login-auth
mvn clean test
mvn exec:java -Dexec.mainClass="com.learningblockchain.auth.App"
```

## Login request example

```bash
curl -X POST http://localhost:8080/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```
