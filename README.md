# Smart Logistics Escrow

A decentralized application (dApp) built on the Ethereum blockchain using Solidity, Web3.js, Truffle, and Supabase. This platform eliminates centralized intermediaries in supply chain logistics by enabling shippers and carriers to manage escrow funds, stake performance collateral, verify milestone completions on-chain, and automate progressive payouts or secure refunds.

---

## Features

- **Role-Based Access Control**  
  Separate registration and authentication workflows for **Shippers** (buyers/creators) and **Carriers** (service providers), enforced both on-chain and off-chain.

- **Escrow Smart Contract Integration**  
  Shippers fund and lock ETH into an escrow agreement upon creation.

- **Strict Milestone & Payout Distribution**  
  Agreements require exactly three checkpoints structured around a mandatory **30%, 30%, and 40%** progressive payout distribution model (Goods Pickup, Warehouse Arrival, and Final Delivery).

- **Carrier Performance Staking**  
  Carriers must lock an exact **30% performance stake** relative to the escrow amount when accepting an active agreement, capped at a maximum of 3 active agreements per carrier.

- **Reputation Token Standard (ERC-20)**  
  Integration of a minimal ERC-20 reputation token, where the escrow contract holds minting rights to reward carriers upon successful agreement completion.

- **Automated Expiry & Refund Handling**  
  If a carrier fails to meet milestones before the deadline, the contract triggers a secure expiry mechanism, refunding remaining escrow to the shipper and forfeiting the carrier's performance stake.

- **Cryptographic Proofs & File Integrity**  
  Milestone submissions link SHA-256 proof hashes recorded immutably on-chain with off-chain encrypted media stored via Supabase Storage.

- **Comprehensive Transaction Ledger**  
  Complete synchronization of blockchain events into Supabase for real-time tracking.

---

# Getting Started & Smart Contract Deployment

## Prerequisites

Make sure the following software is installed:

- [Node.js](https://nodejs.org/) (v16+ recommended)
- Truffle (`npm install -g truffle`)
- MetaMask browser extension
- Ganache (Local workspace running on `http://127.0.0.1:8545`)

---

## 1. Clone the Repository

Clone the repository and navigate to the project directory:

```bash
git clone https://github.com/your-username/Smart_Logistics_Escrow.git
cd Smart_Logistics_Escrow
```

---

## 2. Install Dependencies

Install the required project packages:

```bash
npm install
```

---

# Environment Setup: Local vs. Live

The project supports two deployment workflows depending on whether you are running local diagnostics or presenting a live demo.

| Option | Environment |
|---|---|
| **Option A** | Local Testing (Ganache) |
| **Option B** | Live Presentation using the Sepolia Testnet |

---

# Option A: Local Testing (Ganache)

## 1. Start Ganache

Open your local workspace. Ensure the RPC server runs at `http://127.0.0.1:8545` with Chain ID `1337` or `5777`.

## 2. Configure MetaMask

1. Open MetaMask.
2. Add or select your Ganache local network.
3. Import one of the test accounts using a private key provided by Ganache.
4. Make sure MetaMask is connected to the same Ganache network.

> **Important:** Only use Ganache test accounts for local development. Never use real wallets or real funds with private keys that are shared publicly.

## 3. Compile the Smart Contracts

Run:

```bash
truffle compile
```

## 4. Deploy the Smart Contracts

Deploy the contracts to Ganache:

```bash
truffle migrate --reset
```

After successful deployment, Truffle will display the deployed contract addresses in the terminal.

## 5. Update the Contract Address

Copy the deployed contract addresses for both LogisticsEscrow and LogiTrustToken from the terminal output, then update `CONTRACT_ADDRESS` and `TOKEN_CONTRACT_ADDRESS` in `js/contract.js`.

```javascript
const CONTRACT_ADDRESS = "YOUR_DEPLOYED_GANACHE_ESCROW_ADDRESS";
const TOKEN_CONTRACT_ADDRESS = "YOUR_DEPLOYED_GANACHE_TOKEN_ADDRESS";
```

---

# Option B: Live Presentation (Sepolia Testnet)

The contracts are already deployed and live on Sepolia — `js/contract.js` resolves `CONTRACT_ADDRESS`/`TOKEN_CONTRACT_ADDRESS` automatically based on whichever network MetaMask is connected to, so **for a normal demo you don't need to redeploy anything.** Just connect MetaMask to Sepolia and use the app.

You only need to redeploy if you've changed `LogisticsEscrow.sol` or `LogiTrustToken.sol` and want the new contract logic live on Sepolia.

## 1. Configure MetaMask

Switch MetaMask to the Sepolia Testnet. If it's not already in your network list, MetaMask will prompt to add it automatically when the app asks you to switch (Sepolia is one of MetaMask's built-in networks). Make sure your wallet has some Sepolia ETH — get free testnet ETH from a faucet such as [sepoliafaucet.com](https://sepoliafaucet.com) or [Alchemy's Sepolia faucet](https://www.alchemy.com/faucets/ethereum-sepolia).

## 2. (Redeploy only) Deploy via Truffle Dashboard

No private key, mnemonic, or Infura/Alchemy API key is stored anywhere in this project — deployments are signed directly through MetaMask using Truffle's built-in dashboard, so your key material never leaves your browser.

1. In a terminal, start the dashboard:
   ```bash
   truffle dashboard
   ```
2. Open the URL it prints (`http://localhost:24012`) in your browser and connect MetaMask, with MetaMask's active network set to **Sepolia**.
3. In a second terminal, run the migration through the dashboard:
   ```bash
   truffle migrate --network dashboard --reset
   ```
4. Approve the deployment transactions in the MetaMask popup that appears in the dashboard tab.

## 3. (Redeploy only) Update the Contract Address

After a successful deployment, copy the new `LogisticsEscrow` and `LogiTrustToken` addresses (from the terminal output or `build/contracts/LogisticsEscrow.json` → `networks["11155111"]`) into the Sepolia entry of `NETWORK_ADDRESSES` in `js/contract.js`:

```javascript
const NETWORK_ADDRESSES = {
  // ...
  11155111: {
    contract: "YOUR_VERIFIED_SEPOLIA_ESCROW_ADDRESS",
    token: "YOUR_VERIFIED_SEPOLIA_TOKEN_ADDRESS",
  },
};
```

---

# 3. Run the Application

The frontend can be served using **VS Code Live Server** or another local static file server.

For example, using VS Code:

1. Open the project folder in VS Code.
2. Install the Live Server extension if necessary.
3. Open the application's main HTML file.
4. Right-click the HTML file.
5. Select **Open with Live Server**.

The application should then open in your browser.

---

# 4. Connect MetaMask

Before interacting with the application:

## For Local Testing

Connect MetaMask to:

```text
Ganache Local Network
```

## For Live Presentation

Connect MetaMask to:

```text
Sepolia Testnet
```

Make sure the selected MetaMask account corresponds to the intended role.

---

# 5. Use the Application

Once the application is running:

1. Connect MetaMask.
2. Register as a **Shipper** or **Carrier**.
3. Log in using the selected role.
4. Shippers can create logistics agreements and fund escrow.
5. Carriers can view available agreements and accept assigned agreements.
6. Carriers submit milestone completion.
7. Shippers verify completed milestones.
8. The smart contract releases the corresponding milestone payment.
9. Agreement status and transaction records can be tracked through the application.

---

# Smart Contract Workflow

```text
Shipper ──(Create Agreement + Fund Escrow)──► Smart Contract
                                                    │
                                                    ▼
                                            Carrier (Accepts + Stakes 30%)
                                                    │
                                                    ▼
                                            Carrier (Submit Milestone + Proof Hash)
                                                    │
                                                    ▼
                                            Shipper (Verify Milestone & Release Payout)
                                                    │
                                                    ▼
                                            Smart Contract (Releases ETH / Mints LTT)
```

The process continues until all required milestones are completed.

---

# Technology Stack

| Component | Technology |
|---|---|
| **Blockchain Network** | Ethereum (Local Ganache for testing, Sepolia Testnet for live demonstration) |
| **Smart Contracts** | Solidity ^0.8.0 (Truffle Framework) |
| **Frontend Integration** | Web3.js, HTML5, CSS3, JavaScript |
| **Database & Storage** | Supabase (Relational metadata, transaction audit trails, and milestone evidence caching) |
| **Wallet Management** | MetaMask |

---
