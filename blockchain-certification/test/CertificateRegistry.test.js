const { expect } = require("chai");
const { ethers } = require("hardhat");

// Same formula as frontend/js/common.js
function certificateHash(fileBytes, salt) {
  const fileHash = ethers.keccak256(fileBytes);
  return ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [fileHash, salt]);
}

describe("CertificateRegistry", function () {
  let registry, admin, issuer2, outsider;
  const file = ethers.toUtf8Bytes("%PDF-1.7 diploma of Alice, Master in Computer Science");
  const salt = ethers.hexlify(ethers.randomBytes(32));
  let hash;

  beforeEach(async function () {
    [admin, issuer2, outsider] = await ethers.getSigners();
    registry = await ethers.deployContract("CertificateRegistry", ["My University"]);
    hash = certificateHash(file, salt);
  });

  describe("Hashing", function () {
    it("front-end formula matches the contract's computeHash", async function () {
      expect(await registry.computeHash(ethers.keccak256(file), salt)).to.equal(hash);
    });

    it("a different salt gives a different hash", async function () {
      const other = certificateHash(file, ethers.hexlify(ethers.randomBytes(32)));
      expect(other).to.not.equal(hash);
    });
  });

  describe("Issuing and verifying", function () {
    it("issues and verifies a certificate", async function () {
      await expect(registry.issueCertificate(hash)).to.emit(registry, "CertificateIssued");
      const res = await registry.verifyCertificate(hash);
      expect(res.exists).to.equal(true);
      expect(res.valid).to.equal(true);
      expect(res.issuer).to.equal(admin.address);
      expect(res.institution).to.equal("My University");
      expect(res.revokedAt).to.equal(0n);
      expect(await registry.totalIssued()).to.equal(1n);
    });

    it("returns NOT FOUND for a modified file", async function () {
      await registry.issueCertificate(hash);
      const forged = ethers.toUtf8Bytes(
        "%PDF-1.7 diploma of Alice, Master in Computer Sciencf",
      );
      const res = await registry.verifyCertificate(certificateHash(forged, salt));
      expect(res.exists).to.equal(false);
      expect(res.valid).to.equal(false);
    });

    it("rejects an empty hash", async function () {
      await expect(registry.issueCertificate(ethers.ZeroHash)).to.be.revertedWith(
        "Empty hash",
      );
    });

    it("blocks issuing the same certificate twice", async function () {
      await registry.issueCertificate(hash);
      await expect(registry.issueCertificate(hash)).to.be.revertedWith("Already issued");
    });

    it("blocks wallets without ISSUER_ROLE", async function () {
      await expect(
        registry.connect(outsider).issueCertificate(hash),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Batch issuance", function () {
    it("issues a whole class in one transaction", async function () {
      const hashes = [1, 2, 3].map((i) =>
        certificateHash(
          ethers.toUtf8Bytes(`diploma ${i}`),
          ethers.hexlify(ethers.randomBytes(32)),
        ),
      );
      await registry.issueBatch(hashes);
      for (const h of hashes) {
        expect((await registry.verifyCertificate(h)).valid).to.equal(true);
      }
      expect(await registry.totalIssued()).to.equal(3n);
    });

    it("rejects an empty batch", async function () {
      await expect(registry.issueBatch([])).to.be.revertedWith("Batch size 1-100");
    });

    it("rolls back the whole batch if one hash is already issued", async function () {
      await registry.issueCertificate(hash);
      const fresh = certificateHash(ethers.toUtf8Bytes("other"), salt);
      await expect(registry.issueBatch([fresh, hash])).to.be.revertedWith("Already issued");
      expect((await registry.verifyCertificate(fresh)).exists).to.equal(false);
    });
  });

  describe("Revocation", function () {
    it("revokes a certificate and keeps its history", async function () {
      await registry.issueCertificate(hash);
      await expect(registry.revokeCertificate(hash, "Grading error"))
        .to.emit(registry, "CertificateRevoked")
        .withArgs(hash, admin.address, "Grading error");
      const res = await registry.verifyCertificate(hash);
      expect(res.exists).to.equal(true);
      expect(res.valid).to.equal(false);
      expect(res.revokedAt).to.be.greaterThan(0n);
    });

    it("blocks revoking twice", async function () {
      await registry.issueCertificate(hash);
      await registry.revokeCertificate(hash, "Fraud");
      await expect(registry.revokeCertificate(hash, "Fraud")).to.be.revertedWith(
        "Already revoked",
      );
    });

    it("blocks outsiders from revoking", async function () {
      await registry.issueCertificate(hash);
      await expect(
        registry.connect(outsider).revokeCertificate(hash, "x"),
      ).to.be.revertedWith("Not allowed");
    });

    it("cannot revoke an unknown certificate", async function () {
      await expect(registry.revokeCertificate(hash, "x")).to.be.revertedWith("Not found");
    });
  });

  describe("Multiple institutions", function () {
    it("a second institution issues and revokes its own certificates", async function () {
      await expect(registry.addIssuer(issuer2.address, "Other School"))
        .to.emit(registry, "IssuerAdded")
        .withArgs(issuer2.address, "Other School");
      await registry.connect(issuer2).issueCertificate(hash);
      expect((await registry.verifyCertificate(hash)).institution).to.equal("Other School");
      await registry.connect(issuer2).revokeCertificate(hash, "Error");
      expect((await registry.verifyCertificate(hash)).valid).to.equal(false);
    });

    it("an institution cannot revoke another institution's certificate", async function () {
      await registry.addIssuer(issuer2.address, "Other School");
      await registry.issueCertificate(hash);
      await expect(
        registry.connect(issuer2).revokeCertificate(hash, "x"),
      ).to.be.revertedWith("Not allowed");
    });

    it("only the admin can add institutions", async function () {
      await expect(
        registry.connect(outsider).addIssuer(outsider.address, "Fake"),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("a removed institution cannot issue; its old certificates stay valid", async function () {
      await registry.addIssuer(issuer2.address, "Other School");
      await registry.connect(issuer2).issueCertificate(hash);
      await registry.removeIssuer(issuer2.address);
      const other = certificateHash(ethers.toUtf8Bytes("new"), salt);
      await expect(
        registry.connect(issuer2).issueCertificate(other),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
      expect((await registry.verifyCertificate(hash)).valid).to.equal(true);
    });
  });
});
