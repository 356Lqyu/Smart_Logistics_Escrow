// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract LogisticsEscrow {

    // tracks contract lifecycle
    enum AgreementStatus {
        Created,
        Funded,
        InProgress,
        Completed,
        Refunded,
        Cancelled,
        Expired
    }

    // set shipment urgency level
    enum Priority {
        Normal,
        Express,
        Urgent
    }
    // milestone stuct
    struct Milestone {
        string checkpoint;
        uint percentage;
        bool completed;
        bool verified;
    }
    // struct hold data for each shipment (complete logistics agreement)
    struct Agreement {
        uint agreementId;
        string referenceNo;
        address payable shipper;  // store shipper's ethreum wallet address and allow ETH to be transferred to this address
        address payable carrier;
        string shipmentDetails;
        string notes;
        uint payloadValue;
        uint escrowAmount;
        uint deadline;
        uint createdTime;
        Priority priority;
        AgreementStatus status;
        uint currentMilestone;
    }

    uint public agreementCounter;

    // map agreement ID to Agreement struct
    mapping(uint => Agreement) private agreements;

    // map agreement ID to an array of its checkpoint milestones
    mapping(uint => Milestone[]) public agreementMilestones;

    // store cryptographic hashes of agreement inputs to prevent duplicate agreement spam
    mapping(bytes32 => bool) private agreementHashes;

    event AgreementCreated(
        uint agreementId,
        address shipper,
        uint escrowAmount
    );

    event EscrowFunded(
        uint agreementId,
        uint amount
    );

    event AgreementAccepted(
        uint agreementId,
        address carrier
    );

    event AgreementCancelled(uint agreementId);

    event AgreementExpired(uint agreementId);

    constructor() {

    }

    function getAgreementBasic(uint id)
        external
        view
        returns (
            uint agreementId,
            string memory referenceNo,
            address shipper,
            address carrier,
            uint escrowAmount,
            AgreementStatus status
        )
    {
        Agreement storage a = agreements[id];

        return (
            a.agreementId,
            a.referenceNo,
            a.shipper,
            a.carrier,
            a.escrowAmount,
            a.status
        );
    }

    // for shipper to create a new logistics agreement
    function createAgreement(
        string memory shipmentDetails,
        string memory notes,
        uint payloadValue,
        uint escrowAmount,
        uint deadline,
        Priority priority,
        string[] memory checkpoints,
        uint[] memory percentages
    ) public returns (uint256) {
        // first will validate business constraints (eg,. min escrow, valid deadline, non-empty shipment details, payload value etc)
        // minimum escrow validation must at least 0.01 ETH
        require(escrowAmount >= 0.01 ether,"Minimum escrow is 0.01 ETH");

        // deadline validation (deadline must be in future)
        require(deadline > block.timestamp,"Invalid deadline");

        // no of checkpoints must match the no of pencentage
        require(checkpoints.length == percentages.length,"Invalid milestones");

        // at least one milestone is required
        require(checkpoints.length > 0,"At least one milestone required");

        // payload value > 0
        require(payloadValue > 0,"Payload value must be greater than zero");

        // shipment details cannot be empty
        require(bytes(shipmentDetails).length > 0,"Shipment details required");

        // all milestone percentages must add up to 100%
        uint256 total = 0;
        for (uint256 i = 0; i < percentages.length; i++) {
            total += percentages[i];
        }
        require(total == 100, "Percentages must equal 100");

        // Duplicate agreement check based on unique input combination
        // keccak256() used to create unique hash based on shipper address, shipment details, payload value, escrow amount etc
        bytes32 agreementHash = keccak256(
            abi.encodePacked(
            msg.sender,
            keccak256(bytes(shipmentDetails)),
            payloadValue,
            escrowAmount,
            deadline
            )
        );

        // if same combination is submitted again , the trasaction is rejected
        require(!agreementHashes[agreementHash], "Duplicate agreement detected");
        agreementHashes[agreementHash] = true;

        // all condition satisfied , contract will generate unique agreement ID and reference number
        // Increment agreement counter for unique ID
        agreementCounter++;
        uint256 newId = agreementCounter;

        // generate reference number (e.g., LG-2026-0001)
        string memory refNo = _generateReferenceNo(newId);

        // save agreement details 
        agreements[newId] = Agreement({
            agreementId: newId,
            referenceNo: refNo,
            shipper: payable(msg.sender),
            carrier: payable(address(0)),
            shipmentDetails: shipmentDetails,
            notes: notes,
            payloadValue: payloadValue,
            escrowAmount: escrowAmount,
            deadline: deadline,
            createdTime: block.timestamp,
            priority: priority,
            status: AgreementStatus.Created,
            currentMilestone: 0
        });

        // save milestones
        for (uint256 i = 0; i < checkpoints.length; i++) {
            agreementMilestones[newId].push(
                Milestone({
                    checkpoint: checkpoints[i],
                    percentage: percentages[i],
                    completed: false,
                    verified: false
                })
            );
        }

        // emit creation event
        emit AgreementCreated(
            newId,
            msg.sender,
            escrowAmount
        );

        return newId;
    }

    // helper function to format reference strings like "LG-2026-0001"
    function _generateReferenceNo(uint256 id) internal pure returns (string memory) {
        string memory paddedId;
        if (id < 10) {
            paddedId = string(abi.encodePacked("000", _uintToStr(id)));
        } else if (id < 100) {
            paddedId = string(abi.encodePacked("00", _uintToStr(id)));
        } else if (id < 1000) {
            paddedId = string(abi.encodePacked("0", _uintToStr(id)));
        } else {
            paddedId = _uintToStr(id);
        }

        return string(abi.encodePacked("LG-2026-", paddedId));
    }

    // converts the numeric agreement ID into a string, while the reference function adds leading zeros
    // eg,. ID = 25 will become LG-2026-0025
    function _uintToStr(uint256 _i) internal pure returns (string memory _uintAsString) {
        if (_i == 0) {
            return "0";
        }
        uint256 temp = _i;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (_i != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(_i % 10)));
            _i /= 10;
        }
        return string(buffer);
    }

    // let shipper to deposit ETH into the smart contract
    function fundEscrow(uint256 agreementId) external payable {
        Agreement storage agreement = agreements[agreementId];
        // first will check agreement exist, caller is shipper, agreement status is Created, deadline has not passes, sent ETH = required escrow amount
        require(agreement.agreementId != 0, "Agreement does not exist");
        require(msg.sender == agreement.shipper, "Only shipper can fund escrow");
        require(agreement.status == AgreementStatus.Created, "Agreement is not in Created status");
        require(block.timestamp <= agreement.deadline,"Agreement deadline has passed");
        require(msg.value == agreement.escrowAmount,"Incorrect ETH amount sent");

        // success paymnet : Created to Funded
        agreement.status = AgreementStatus.Funded;

        emit EscrowFunded(agreementId, msg.value);
    }

    // allows a carrier to accept a funded agreement
    function acceptAgreement(uint256 agreementId) external {
        Agreement storage agreement = agreements[agreementId];

        // check agreement exists, status is Funded, deadline has no passed, caller cannot be same person as shipper
        require(agreement.agreementId != 0, "Agreement does not exist");
        require(agreement.status == AgreementStatus.Funded,"Agreement is not in Funded status");
        require(block.timestamp <= agreement.deadline,"Agreement deadline has passed");
        require(msg.sender != agreement.shipper,"Shipper cannot act as carrier");

        agreement.carrier = payable(msg.sender);
        // after acceptance : Funded to InProgress
        agreement.status = AgreementStatus.InProgress;

        emit AgreementAccepted(agreementId, msg.sender);
    }

    // allow the shipper to cancel an agreement
    function cancelAgreement(uint256 agreementId) external {
        Agreement storage agreement = agreements[agreementId];
        // check agreement exits, must be shipper, agreement status = Created
        require(agreement.agreementId != 0, "Agreement does not exist");
        require(msg.sender == agreement.shipper, "Only shipper can cancel");
        require(agreement.status == AgreementStatus.Created,"Cannot cancel an active or finalized agreement");

        // chaneg to Cancelled
        agreement.status = AgreementStatus.Cancelled;

        emit AgreementCancelled(agreementId);
    }

    // marks agreement as expired after deadline and refunds the shipper if funded
    function expireAgreement(uint256 agreementId) external {
        Agreement storage agreement = agreements[agreementId];

        // check agreement exits, current time is past the deadline, status = Created/Funded/InProgress
        require(agreement.agreementId != 0, "Agreement does not exist");
        require(block.timestamp > agreement.deadline,"Agreement deadline has not passed yet");
        require(
            agreement.status == AgreementStatus.Created || 
            agreement.status == AgreementStatus.Funded || 
            agreement.status == AgreementStatus.InProgress,
            "Agreement cannot be expired from current status"
        );

        AgreementStatus previousStatus = agreement.status;
        // change status to Expired
        agreement.status = AgreementStatus.Expired;

        // if agreemet was already funded, escrow amount is sent back to shipper
        if (previousStatus == AgreementStatus.Funded || previousStatus == AgreementStatus.InProgress) {
            uint256 refundAmount = agreement.escrowAmount;
            agreement.escrowAmount = 0; // Prevent refund from being processed again

            (bool success, ) = agreement.shipper.call{value: refundAmount}("");
            require(success, "Refund transfer failed");
        }

        emit AgreementExpired(agreementId);
    }
}