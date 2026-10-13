# CertChain: academic certificates on Ethereum

A university registers a fingerprint (hash) of each diploma on Ethereum. Anyone can check a
diploma for free, without the diploma's content ever being published.

- **Immutable storage**: `contracts/CertificateRegistry.sol` stores hash, issuer, date, revocation date
- **Verification by hash**: the browser hashes the file locally; only the hash is compared on-chain
- **Web interface**: `frontend/` (ethers.js 6 + MetaMask for issuers, no wallet needed to verify)

Extras: random salt per diploma, QR code verification link, revocation with reason,
multiple institutions, batch issuance (up to 100 per transaction), events.

## Deployed contract

| Network | Address |
|---|---|
| Sepolia | `0x...` (fill in after deployment) |
| Etherscan | https://sepolia.etherscan.io/address/0x... |

## How the hash is computed

```
certificateHash = keccak256( keccak256(fileBytes) || salt )     salt = 32 random bytes
```

The salt is given to the student with the diploma (printed, or inside the QR code link).
Without it, nobody can test guesses against the public hashes.

## Run it (Ubuntu / Linux)

```bash
npm install
npm test                          # 18 tests
npm run node                      # terminal 1: local blockchain
npm run deploy:local              # terminal 2: deploy + writes frontend/js/config.js
npm run serve                     # terminal 3: http://localhost:3000
```

Sepolia: copy `.env.example` to `.env`, fill it in, then `npm run deploy:sepolia`.

## Demo files

`demo-files/` has a sample diploma, the same diploma with one grade changed (to show NOT FOUND),
and three files for the batch demo.

## Team

- Member A: smart contract, tests, deployment
- Member B: web interface, demo, slides
