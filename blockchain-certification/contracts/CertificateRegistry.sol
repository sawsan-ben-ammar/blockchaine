// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title CertificateRegistry
/// @notice Stores only the fingerprint (hash) of each diploma, never its content.
/// certificateHash = keccak256(abi.encodePacked(keccak256(fileBytes), salt))
contract CertificateRegistry is AccessControl {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    uint256 public constant MAX_BATCH = 100;

    struct Certificate {
        address issuer;
        uint64 issuedAt;
        uint64 revokedAt; // 0 = still valid
    }

    mapping(bytes32 => Certificate) private certificates;
    mapping(address => string) public institutionName;
    uint256 public totalIssued;

    event IssuerAdded(address indexed issuer, string name);
    event IssuerRemoved(address indexed issuer);
    event CertificateIssued(bytes32 indexed hash, address indexed issuer, uint64 issuedAt);
    event CertificateRevoked(
        bytes32 indexed hash,
        address indexed revokedBy,
        string reason
    );

    constructor(string memory adminInstitution) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ISSUER_ROLE, msg.sender);
        institutionName[msg.sender] = adminInstitution;
        emit IssuerAdded(msg.sender, adminInstitution);
    }

    // ---------- Institutions (admin only) ----------

    function addIssuer(
        address issuer,
        string calldata name
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(issuer != address(0), "Zero address");
        require(bytes(name).length > 0, "Empty name");
        _grantRole(ISSUER_ROLE, issuer);
        institutionName[issuer] = name;
        emit IssuerAdded(issuer, name);
    }

    /// Old certificates of this wallet stay valid; it just cannot issue new ones.
    function removeIssuer(address issuer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(hasRole(ISSUER_ROLE, issuer), "Not an issuer");
        _revokeRole(ISSUER_ROLE, issuer);
        emit IssuerRemoved(issuer);
    }

    // ---------- Issuing ----------

    function issueCertificate(bytes32 hash) external onlyRole(ISSUER_ROLE) {
        _issue(hash);
    }

    /// Issue a whole class in one transaction (cheaper than one transaction per diploma).
    function issueBatch(bytes32[] calldata hashes) external onlyRole(ISSUER_ROLE) {
        require(hashes.length > 0 && hashes.length <= MAX_BATCH, "Batch size 1-100");
        for (uint256 i = 0; i < hashes.length; i++) {
            _issue(hashes[i]);
        }
    }

    function _issue(bytes32 hash) private {
        require(hash != bytes32(0), "Empty hash");
        require(certificates[hash].issuedAt == 0, "Already issued");
        uint64 nowTs = uint64(block.timestamp);
        certificates[hash] = Certificate(msg.sender, nowTs, 0);
        totalIssued++;
        emit CertificateIssued(hash, msg.sender, nowTs);
    }

    // ---------- Revoking ----------

    /// Only the original issuer (while still an issuer) or the admin can revoke.
    /// Nothing is deleted: the certificate is marked revoked, history stays on-chain.
    function revokeCertificate(bytes32 hash, string calldata reason) external {
        Certificate storage c = certificates[hash];
        require(c.issuedAt != 0, "Not found");
        require(c.revokedAt == 0, "Already revoked");
        bool isOriginalIssuer = msg.sender == c.issuer && hasRole(ISSUER_ROLE, msg.sender);
        require(isOriginalIssuer || hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Not allowed");
        c.revokedAt = uint64(block.timestamp);
        emit CertificateRevoked(hash, msg.sender, reason);
    }

    // ---------- Verifying (free, read-only) ----------

    function verifyCertificate(
        bytes32 hash
    )
        external
        view
        returns (
            bool exists,
            bool valid,
            address issuer,
            string memory institution,
            uint64 issuedAt,
            uint64 revokedAt
        )
    {
        Certificate memory c = certificates[hash];
        exists = c.issuedAt != 0;
        valid = exists && c.revokedAt == 0;
        issuer = c.issuer;
        institution = institutionName[c.issuer];
        issuedAt = c.issuedAt;
        revokedAt = c.revokedAt;
    }

    /// Same formula the web pages use, so tests can prove both sides agree.
    function computeHash(bytes32 fileHash, bytes32 salt) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(fileHash, salt));
    }
}
