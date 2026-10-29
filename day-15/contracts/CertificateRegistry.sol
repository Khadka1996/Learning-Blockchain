// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title CertificateRegistry — Day 15 capstone
 * @author Manish Khadka
 * @notice A public notice board for certificates. A school (an "issuer") posts the
 *         fingerprint (hash) of each certificate it gives out. Anyone can later check a
 *         certificate by recomputing its fingerprint and asking this contract.
 *
 *         Only fingerprints go on-chain — never names or grades. The certificate file
 *         itself contains a random salt, so nobody can guess a fingerprint from public
 *         facts like "Manish Khadka, Blockchain 101".
 *
 *         Records are stored per (issuer, hash). Each school has its own column on the
 *         board, so one school can never take over or block another school's
 *         certificate (QA finding M1: front-running in my first design, contracts/v1).
 *
 * Roles
 *   DEFAULT_ADMIN_ROLE  adds / removes issuers, can revoke any certificate (e.g. after a
 *                       stolen issuer key). Should be a multisig in production.
 *   ISSUER_ROLE         issues certificates and revokes its OWN certificates.
 */
contract CertificateRegistry is AccessControl {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    uint256 public constant MAX_BATCH = 100; // keeps one batch far below the block gas limit
    uint256 public constant MAX_REASON_BYTES = 200;

    enum Status {
        Unknown, // never issued here
        Valid,
        Revoked
    }

    /// @dev Packed into ONE storage slot: 5 + 5 = 10 bytes. uint40 seconds lasts ~34,000 years.
    struct Record {
        uint40 issuedAt; // 0 = never issued (block.timestamp is never 0 on a real chain)
        uint40 revokedAt; // 0 = not revoked
    }

    mapping(address issuer => mapping(bytes32 certHash => Record)) private _records;
    uint256 public issuedCount;
    uint256 public revokedCount;

    event CertificateIssued(address indexed issuer, bytes32 indexed certHash);
    event CertificateRevoked(address indexed issuer, bytes32 indexed certHash, address indexed revokedBy, string reason);

    error ZeroAddress();
    error ZeroHash();
    error AlreadyIssued(bytes32 certHash);
    error NotIssued(bytes32 certHash);
    error AlreadyRevoked(bytes32 certHash);
    error NotAllowedToRevoke(address caller);
    error BadBatchSize(uint256 size);
    error ReasonTooLong(uint256 length);

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ------------------------------------------------------------------ issue

    /// @notice Record one certificate fingerprint. Only issuers.
    function issue(bytes32 certHash) external onlyRole(ISSUER_ROLE) {
        _issue(certHash);
        unchecked {
            ++issuedCount; // cannot realistically overflow a uint256
        }
    }

    /// @notice Record up to MAX_BATCH fingerprints in one transaction (a whole class).
    function issueBatch(bytes32[] calldata certHashes) external onlyRole(ISSUER_ROLE) {
        uint256 n = certHashes.length;
        if (n == 0 || n > MAX_BATCH) revert BadBatchSize(n);
        for (uint256 i; i < n; ++i) _issue(certHashes[i]);
        unchecked {
            issuedCount += n; // one storage write for the whole batch (Slither: costly-loop)
        }
    }

    function _issue(bytes32 certHash) private {
        if (certHash == bytes32(0)) revert ZeroHash();
        Record storage r = _records[msg.sender][certHash];
        // A revoked certificate keeps its record forever, so it can never be "re-issued"
        // back to Valid by anyone.
        if (r.issuedAt != 0) revert AlreadyIssued(certHash);
        r.issuedAt = uint40(block.timestamp);
        emit CertificateIssued(msg.sender, certHash);
    }

    // ----------------------------------------------------------------- revoke

    /// @notice Cancel a certificate. Its own (still active) issuer or an admin may do this.
    function revoke(address issuer, bytes32 certHash, string calldata reason) external {
        if (bytes(reason).length > MAX_REASON_BYTES) revert ReasonTooLong(bytes(reason).length);
        Record storage r = _records[issuer][certHash];
        if (r.issuedAt == 0) revert NotIssued(certHash);
        if (r.revokedAt != 0) revert AlreadyRevoked(certHash);
        // The issuer itself — but only while it still holds ISSUER_ROLE. A removed issuer
        // (e.g. its key was stolen) must not keep the power to cancel real certificates
        // (QA finding M3). After removal, only the admin can revoke its certificates.
        bool ownActiveIssuer = msg.sender == issuer && hasRole(ISSUER_ROLE, msg.sender);
        if (!ownActiveIssuer && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert NotAllowedToRevoke(msg.sender);
        r.revokedAt = uint40(block.timestamp);
        unchecked {
            ++revokedCount;
        }
        emit CertificateRevoked(issuer, certHash, msg.sender, reason);
    }

    // ----------------------------------------------------------------- verify

    /**
     * @notice Check a certificate fingerprint. Free to call (no transaction needed).
     * @param issuer   the issuer address written inside the certificate file
     * @param certHash keccak256 of the certificate's canonical text
     * @return status       Unknown / Valid / Revoked
     * @return issuedAt     unix time it was issued
     * @return revokedAt    unix time it was revoked (0 if not)
     * @return issuerActive whether that issuer still holds ISSUER_ROLE today
     */
    function verify(address issuer, bytes32 certHash)
        external
        view
        returns (Status status, uint40 issuedAt, uint40 revokedAt, bool issuerActive)
    {
        Record memory r = _records[issuer][certHash];
        issuerActive = hasRole(ISSUER_ROLE, issuer);
        if (r.issuedAt == 0) return (Status.Unknown, 0, 0, issuerActive);
        status = r.revokedAt == 0 ? Status.Valid : Status.Revoked;
        return (status, r.issuedAt, r.revokedAt, issuerActive);
    }
}
