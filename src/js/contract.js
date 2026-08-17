const CONTRACT_ADDRESS =
    "0x3A26d0E54dd095Bc143fdDC19aD7e8dB2131f495";


const CONTRACT_ABI = [
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "agreementId",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "address",
          "name": "carrier",
          "type": "address"
        }
      ],
      "name": "AgreementAccepted",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "agreementId",
          "type": "uint256"
        }
      ],
      "name": "AgreementCancelled",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "agreementId",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "address",
          "name": "shipper",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "escrowAmount",
          "type": "uint256"
        }
      ],
      "name": "AgreementCreated",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "agreementId",
          "type": "uint256"
        }
      ],
      "name": "AgreementExpired",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "agreementId",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "amount",
          "type": "uint256"
        }
      ],
      "name": "EscrowFunded",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "user",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "enum LogisticsEscrow.UserRole",
          "name": "role",
          "type": "uint8"
        }
      ],
      "name": "UserRegistered",
      "type": "event"
    },
    {
      "inputs": [],
      "name": "agreementCounter",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function",
      "constant": true
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "name": "agreementMilestones",
      "outputs": [
        {
          "internalType": "string",
          "name": "checkpoint",
          "type": "string"
        },
        {
          "internalType": "uint256",
          "name": "percentage",
          "type": "uint256"
        },
        {
          "internalType": "bool",
          "name": "completed",
          "type": "bool"
        },
        {
          "internalType": "bool",
          "name": "verified",
          "type": "bool"
        }
      ],
      "stateMutability": "view",
      "type": "function",
      "constant": true
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "name": "users",
      "outputs": [
        {
          "internalType": "string",
          "name": "name",
          "type": "string"
        },
        {
          "internalType": "enum LogisticsEscrow.UserRole",
          "name": "role",
          "type": "uint8"
        },
        {
          "internalType": "bool",
          "name": "registered",
          "type": "bool"
        }
      ],
      "stateMutability": "view",
      "type": "function",
      "constant": true
    },
    {
      "inputs": [
        {
          "internalType": "string",
          "name": "_name",
          "type": "string"
        },
        {
          "internalType": "enum LogisticsEscrow.UserRole",
          "name": "_role",
          "type": "uint8"
        }
      ],
      "name": "register",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "id",
          "type": "uint256"
        }
      ],
      "name": "getAgreementBasic",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "agreementId",
          "type": "uint256"
        },
        {
          "internalType": "string",
          "name": "referenceNo",
          "type": "string"
        },
        {
          "internalType": "address",
          "name": "shipper",
          "type": "address"
        },
        {
          "internalType": "address",
          "name": "carrier",
          "type": "address"
        },
        {
          "internalType": "uint256",
          "name": "escrowAmount",
          "type": "uint256"
        },
        {
          "internalType": "enum LogisticsEscrow.AgreementStatus",
          "name": "status",
          "type": "uint8"
        }
      ],
      "stateMutability": "view",
      "type": "function",
      "constant": true
    },
    {
      "inputs": [
        {
          "internalType": "string",
          "name": "shipmentDetails",
          "type": "string"
        },
        {
          "internalType": "string",
          "name": "notes",
          "type": "string"
        },
        {
          "internalType": "uint256",
          "name": "payloadValue",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "escrowAmount",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "deadline",
          "type": "uint256"
        },
        {
          "internalType": "enum LogisticsEscrow.Priority",
          "name": "priority",
          "type": "uint8"
        },
        {
          "internalType": "string[]",
          "name": "checkpoints",
          "type": "string[]"
        },
        {
          "internalType": "uint256[]",
          "name": "percentages",
          "type": "uint256[]"
        }
      ],
      "name": "createAgreement",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "agreementId",
          "type": "uint256"
        }
      ],
      "name": "fundEscrow",
      "outputs": [],
      "stateMutability": "payable",
      "type": "function",
      "payable": true
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "agreementId",
          "type": "uint256"
        }
      ],
      "name": "acceptAgreement",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "agreementId",
          "type": "uint256"
        }
      ],
      "name": "cancelAgreement",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "agreementId",
          "type": "uint256"
        }
      ],
      "name": "expireAgreement",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    }
];


let web3;
let contract;
let currentAccount;