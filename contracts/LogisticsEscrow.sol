// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract LogisticsEscrow {

    enum AgreementStatus {
        Created,
        Funded,
        InProgress,
        Completed,
        Refunded,
        Cancelled,
        Expired
    }

    enum Priority {
        Normal,
        Express,
        Urgent
    }

    struct Milestone {
        string checkpoint;
        uint percentage;
        bool completed;
        bool verified;
    }

    struct Agreement {
        uint agreementId;
        string referenceNo;
        address payable shipper;
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

    mapping(uint => Agreement) private agreements;
    mapping(uint => Milestone[]) public agreementMilestones;

    event AgreementCreated(
        uint agreementId,
        address shipper,
        uint escrowAmount
    );

    event EscrowFunded(
        uint agreementId,
        uint amount
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
}