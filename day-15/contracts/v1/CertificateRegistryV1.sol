// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title CertificateRegistryV1 — my FIRST design, kept only to show QA finding M1.
 * @dev DO NOT USE. Records are keyed by the hash alone, so a rival issuer can
 *      front-run an issue() and steal/block the hash. Fixed in ../CertificateRegistry.sol.
 * @author Manish Khadka
 * @notice A public notice board for certificates. A school (an "issuer") posts the
 *         fingerprint (hash) of each certificate it gives out. Anyone can later check a
 *         certificate by recomputing its fingerprint and asking this contract.
 *
 *         Only fingerprints go on-chain — never names or grades. The certificate file
 *         itself contains a random salt, so nobody can guess a fingerprint from public
 *         facts like "Manish Khadka, Blockchain 101".
 *
 * Roles
 *   DEFAULT_ADMIN_ROLE  adds / removes issuers, can revoke any certificate (e.g. after a
 *                       stolen issuer key). Should be a multisig in production.
 *   ISSUER_ROLE         issues certificates and revokes its OWN certificates.
 */
contract CertificateRegistryV1 is AccessControl {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    uint256 public constant MAX_BATCH = 100; // keeps one batch far below the block gas limit
    uint256 public constant MAX_REASON_BYTES = 200;

    enum Status {
        Unknown, // never issued here
        Valid,
        Revoked
    }

    /// @dev Packed into ONE storage slot: 20 + 5 + 5 = 30 bytes. uint40 seconds lasts ~34,000 years.
    struct Record {
        address issuer;
        uint40 issuedAt;
        uint40 revokedAt; // 0 = not revoked
    }

    mapping(bytes32 certHash => Record) private _records;
    uint256 public issuedCount;
    uint256 public revokedCount;

    event CertificateIssued(bytes32 indexed certHash, address indexed issuer);
    event CertificateRevoked(bytes32 indexed certHash, address indexed revokedBy, string reason);

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
    }

    /// @notice Record up to MAX_BATCH fingerprints in one transaction (a whole class).
    function issueBatch(bytes32[] calldata certHashes) external onlyRole(ISSUER_ROLE) {
        uint256 n = certHashes.length;
        if (n == 0 || n > MAX_BATCH) revert BadBatchSize(n);
        for (uint256 i; i < n; ++i) _issue(certHashes[i]);
    }

    function _issue(bytes32 certHash) private {
        if (certHash == bytes32(0)) revert ZeroHash();
        Record storage r = _records[certHash];
        // A revoked certificate keeps its record forever, so it can never be "re-issued"
        // back to Valid by anyone.
        if (r.issuer != address(0)) revert AlreadyIssued(certHash);
        r.issuer = msg.sender;
        r.issuedAt = uint40(block.timestamp);
        unchecked {
            ++issuedCount; // cannot realistically overflow a uint256
        }
        emit CertificateIssued(certHash, msg.sender);
    }

    // ----------------------------------------------------------------- revoke

    /// @notice Cancel a certificate. Its original issuer or an admin may do this.
    function revoke(bytes32 certHash, string calldata reason) external {
        if (bytes(reason).length > MAX_REASON_BYTES) revert ReasonTooLong(bytes(reason).length);
        Record storage r = _records[certHash];
        if (r.issuer == address(0)) revert NotIssued(certHash);
        if (r.revokedAt != 0) revert AlreadyRevoked(certHash);
        if (msg.sender != r.issuer && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert NotAllowedToRevoke(msg.sender);
        r.revokedAt = uint40(block.timestamp);
        unchecked {
            ++revokedCount;
        }
        emit CertificateRevoked(certHash, msg.sender, reason);
    }

    // ----------------------------------------------------------------- verify

    /**
     * @notice Check a certificate fingerprint. Free to call (no transaction needed).
     * @return status       Unknown / Valid / Revoked
     * @return issuer       who issued it (address(0) if Unknown)
     * @return issuedAt     unix time it was issued
     * @return revokedAt    unix time it was revoked (0 if not)
     * @return issuerActive whether that issuer still holds ISSUER_ROLE today
     */
    function verify(bytes32 certHash)
        external
        view
        returns (Status status, address issuer, uint40 issuedAt, uint40 revokedAt, bool issuerActive)
    {
        Record memory r = _records[certHash];
        if (r.issuer == address(0)) return (Status.Unknown, address(0), 0, 0, false);
        status = r.revokedAt == 0 ? Status.Valid : Status.Revoked;
        return (status, r.issuer, r.issuedAt, r.revokedAt, hasRole(ISSUER_ROLE, r.issuer));
    }
}
