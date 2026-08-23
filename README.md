# Smart Logistics Escrow

A decentralized application (dApp) built on Ethereum using **Solidity** and **Web3.js** that enables shippers and carriers to manage escrow funds, verify logistics milestones on-chain, and automate progressive payouts or refunds.

---

## Features

* **Role-Based Access Control:** Separate registration and workflow dashboards for Shippers and Carriers.
* **Escrow Smart Contract Integration:** Shippers lock ETH into an escrow agreement upon creation, which is securely managed by the smart contract.
* **Milestone Progress Management:** Progressive percentage-based milestone tracking, such as Pickup, Warehouse Arrival, and Final Delivery.
* **Sequential Verification & Payouts:** Carriers submit milestone completion requests, while Shippers verify them to trigger programmatic ETH payouts.
* **Transparent Transaction Ledger:** Real-time tracking of agreement lifecycles, milestone payouts, and agreement creation events.

---

## Getting Started & Smart Contract Deployment

Follow the steps below to set up, compile, and deploy the smart contracts locally using **Truffle** and **Ganache**, or deploy them to the **Sepolia Testnet** for presentation.

### Prerequisites

Make sure the following software is installed:

* [Node.js](https://nodejs.org/) (v16+ recommended)
* Truffle
* MetaMask browser extension
* Ganache

Install Truffle globally if it is not already installed:

```bash
npm install -g truffle
```

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

# Environment Setup: Testing vs. Presentation

The application supports two deployment environments:

* **Option A:** Local Testing using Ganache
* **Option B:** Live Presentation using the Sepolia Testnet

---

## Option A: Local Testing (Ganache)

Use this setup for local development and functional testing.

### 1. Start Ganache

Open your Ganache workspace and start the local Ethereum blockchain.

The commonly used network IDs are:

```text
1337
```

or

```text
5777
```

### 2. Configure MetaMask

1. Open MetaMask.
2. Add or select your Ganache local network.
3. Import one of the test accounts using a private key provided by Ganache.
4. Make sure MetaMask is connected to the same Ganache network.

> **Important:** Only use Ganache test accounts for local development. Never use real wallets or real funds with private keys that are shared publicly.

### 3. Compile the Smart Contracts

Run:

```bash
truffle compile
```

### 4. Deploy the Smart Contracts

Deploy the contracts to Ganache:

```bash
truffle migrate --reset
```

After successful deployment, Truffle will display the deployed contract addresses in the terminal.

### 5. Update the Contract Address

Copy the deployed smart contract address from the terminal and update the `CONTRACT_ADDRESS` value in:

```text
js/contract.js
```

For example:

```javascript
const CONTRACT_ADDRESS = "YOUR_DEPLOYED_CONTRACT_ADDRESS";
```

---

## Option B: Live Presentation (Sepolia Testnet)

Use this setup when presenting the project to judges, instructors, or other users.

### 1. Configure MetaMask

Switch MetaMask to the:

```text
Sepolia Testnet
```

Make sure the deployment wallet has sufficient **Sepolia ETH** for transaction fees.

Sepolia ETH can be obtained from a compatible Sepolia faucet.

### 2. Configure Truffle

Open:

```text
truffle-config.js
```

Ensure that your Sepolia network configuration is correctly configured.

For example, the configuration may use an RPC provider such as **Infura** or **Alchemy** and a deployment wallet.

> **Security:** Never commit your wallet's private key, seed phrase, API key, or other sensitive credentials to GitHub. Use environment variables or a `.env` file that is excluded through `.gitignore`.

### 3. Deploy to Sepolia

Run:

```bash
truffle migrate --network sepolia --reset
```

After deployment completes, Truffle will display the deployed contract address.

### 4. Update the Contract Address

Copy the newly deployed Sepolia contract address and update:

```text
js/contract.js
```

For example:

```javascript
const CONTRACT_ADDRESS = "YOUR_SEPOLIA_CONTRACT_ADDRESS";
```

---

# 3. Run the Application

The frontend can be served using **VS Code Live Server** or another local static file server.

For example, using VS Code:

1. Open the project folder in VS Code.
2. Install the **Live Server** extension if necessary.
3. Open the application's main HTML file.
4. Right-click the HTML file.
5. Select **Open with Live Server**.

The application should then open in your browser.

---

# 4. Connect MetaMask

Before interacting with the application:

### For Local Testing

Connect MetaMask to:

```text
Ganache Local Network
```

### For Live Presentation

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

The overall escrow workflow is:

```text
Shipper
   │
   │ Create Agreement + Fund Escrow
   ▼
Smart Contract
   │
   │ Agreement Created
   ▼
Carrier
   │
   │ Accept Agreement
   ▼
Carrier
   │
   │ Submit Milestone
   ▼
Shipper
   │
   │ Verify Milestone
   ▼
Smart Contract
   │
   │ Release Milestone Payment
   ▼
Carrier
```

The process continues until all required milestones are completed.

---

# Technology Stack

| Technology                  | Purpose                                   |
| --------------------------- | ----------------------------------------- |
| **Ethereum**                | Blockchain network                        |
| **Solidity**                | Smart contract development                |
| **Web3.js**                 | Blockchain interaction from the frontend  |
| **Truffle**                 | Smart contract compilation and deployment |
| **Ganache**                 | Local Ethereum blockchain for testing     |
| **MetaMask**                | Wallet and transaction signing            |
| **Sepolia**                 | Ethereum testnet for live presentation    |
| **JavaScript / HTML / CSS** | Frontend application                      |

---
