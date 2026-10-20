const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StudyLog: Solidity's building blocks", function () {
  let log, learner, other;
  const STATUS = { Planned: 0n, Learning: 1n, Done: 2n };

  beforeEach(async function () {
    [learner, other] = await ethers.getSigners();
    log = await (await ethers.getContractFactory("StudyLog")).deploy();
    await log.waitForDeployment();
  });

  describe("constants and immutables", function () {
    it("exposes constants and the immutable learner", async function () {
      expect(await log.MAX_NAME_BYTES()).to.equal(64n);
      expect(await log.LAST_DAY()).to.equal(15n);
      expect(await log.learner()).to.equal(learner.address);
    });
  });

  describe("addTopic (struct, array, mapping, calldata)", function () {
    it("stores a topic as Planned and emits TopicAdded with indexed id and day", async function () {
      await expect(log.addTopic("Solidity basics", 6))
        .to.emit(log, "TopicAdded")
        .withArgs(0n, 6n, "Solidity basics");
      const topic = await log.getTopic(0);
      expect(topic.name).to.equal("Solidity basics");
      expect(topic.day).to.equal(6n);
      expect(topic.status).to.equal(STATUS.Planned);
      expect(topic.updatedAt).to.be.greaterThan(0n);
      expect(await log.topicCount()).to.equal(1n);
    });

    it("hands out ids 0, 1, 2 in order", async function () {
      await log.addTopic("a", 1);
      await log.addTopic("b", 2);
      expect(await log.addTopic.staticCall("c", 3)).to.equal(2n);
    });

    it("rejects an empty name, a name over 64 bytes and a day after 15", async function () {
      await expect(log.addTopic("", 1)).to.be.revertedWithCustomError(log, "EmptyName");
      await expect(log.addTopic("x".repeat(65), 1))
        .to.be.revertedWithCustomError(log, "NameTooLong")
        .withArgs(65n, 64n);
      await expect(log.addTopic("ok", 16)).to.be.revertedWithCustomError(log, "DayOutOfRange").withArgs(16n);
    });

    it("accepts the boundaries: a 64-byte name and day 15 and day 0", async function () {
      await log.addTopic("x".repeat(64), 15);
      await log.addTopic("y", 0);
      expect(await log.topicCount()).to.equal(2n);
    });

    it("counts BYTES, not characters: a 22-letter name of 3-byte characters is 66 bytes and is rejected", async function () {
      await expect(log.addTopic("€".repeat(22), 1)).to.be.revertedWithCustomError(log, "NameTooLong").withArgs(66n, 64n);
    });

    it("rejects a duplicate name", async function () {
      await log.addTopic("Hashing", 1);
      await expect(log.addTopic("Hashing", 2)).to.be.revertedWithCustomError(log, "DuplicateTopic").withArgs("Hashing");
    });

    it("only the learner can write", async function () {
      await expect(log.connect(other).addTopic("x", 1))
        .to.be.revertedWithCustomError(log, "NotLearner")
        .withArgs(other.address);
    });
  });

  describe("setStatus (enum, storage pointer)", function () {
    beforeEach(async function () {
      await log.addTopic("Merkle trees", 4);
    });

    it("changes the status and emits StatusChanged(id, from, to)", async function () {
      await expect(log.setStatus(0, STATUS.Done)).to.emit(log, "StatusChanged").withArgs(0n, STATUS.Planned, STATUS.Done);
      expect((await log.getTopic(0)).status).to.equal(STATUS.Done);
    });

    it("rejects an unknown id", async function () {
      await expect(log.setStatus(1, STATUS.Done)).to.be.revertedWithCustomError(log, "UnknownTopic").withArgs(1n);
      await expect(log.getTopic(1)).to.be.revertedWithCustomError(log, "UnknownTopic");
    });

    it("an out-of-range enum value (3) is refused by the ABI decoder before any of our code runs", async function () {
      const raw = (value) => log.interface.encodeFunctionData("setStatus", [0, 0]).slice(0, -1) + value;
      const to = await log.getAddress();
      // Control: the very same hand-built call with 2 (= Done) is valid and works...
      await learner.sendTransaction({ to, data: raw("2") });
      expect((await log.getTopic(0)).status).to.equal(STATUS.Done);
      // ...so the only difference is the enum value 3, which does not exist.
      await expect(learner.sendTransaction({ to, data: raw("3") })).to.be.reverted;
      expect((await log.getTopic(0)).status).to.equal(STATUS.Done);
    });

    it("only the learner can change a status", async function () {
      await expect(log.connect(other).setStatus(0, STATUS.Done)).to.be.revertedWithCustomError(log, "NotLearner");
    });
  });

  describe("view and pure", function () {
    it("countByStatus loops over storage and counts matches", async function () {
      for (const [i, name] of ["a", "b", "c", "d"].entries()) await log.addTopic(name, i);
      await log.setStatus(0, STATUS.Done);
      await log.setStatus(1, STATUS.Done);
      await log.setStatus(2, STATUS.Learning);
      expect(await log.countByStatus(STATUS.Done)).to.equal(2n);
      expect(await log.countByStatus(STATUS.Learning)).to.equal(1n);
      expect(await log.countByStatus(STATUS.Planned)).to.equal(1n);
    });

    it("nameLength is pure: it needs no chain state and counts bytes", async function () {
      expect(await log.nameLength("")).to.equal(0n);
      expect(await log.nameLength("hash")).to.equal(4n);
      expect(await log.nameLength("€")).to.equal(3n);
    });
  });
});
