// Import types and APIs from graph-ts
import { BigInt, ByteArray, Bytes, store } from "@graphprotocol/graph-ts";
// Import event types from the registry contract ABI
import {
  NameUnwrapped as NameUnwrappedEvent,
  NameWrapped as NameWrappedEvent,
  TransferBatch as TransferBatchEvent,
  TransferSingle as TransferSingleEvent,
} from "./types/NameWrapper/NameWrapper";
// Import entity types generated from the GraphQL schema
import {
  ExpiryExtended,
  FusesSet,
  NameUnwrapped,
  NameWrapped,
  WrappedDomain,
  WrappedTransfer,
} from "./types/schema";
import {
  checkValidLabel,
  concat,
  createEventID,
  createOrLoadAccount,
  createOrLoadDomain,
} from "./utils";

function decodeName(buf: Bytes): Array<string> | null {
  let offset = 0;
  let list = new ByteArray(0);
  let dot = Bytes.fromHexString("2e");
  let len = buf[offset++];
  let hex = buf.toHexString();
  let firstLabel = "";
  if (len === 0) {
    return [firstLabel, "."];
  }

  while (len) {
    let label = hex.slice((offset + 1) * 2, (offset + 1 + len) * 2);
    let labelBytes = Bytes.fromHexString(label);

    if (!checkValidLabel(labelBytes.toString())) {
      return null;
    }

    if (offset > 1) {
      list = concat(list, dot);
    } else {
      firstLabel = labelBytes.toString();
    }
    list = concat(list, labelBytes);
    offset += len;
    len = buf[offset++];
  }
  return [firstLabel, list.toString()];
}

export function handleNameWrapped(event: NameWrappedEvent): void {
  let decoded = decodeName(event.params.name);
  let label: string | null = null;
  let name: string | null = null;
  if (decoded !== null) {
    label = decoded[0];
    name = decoded[1];
  }
  let node = event.params.node;
  let fuses = event.params.fuses;
  let blockNumber = event.block.number.toI32();
  let transactionID = event.transaction.hash;
  let owner = createOrLoadAccount(event.params.owner.toHex());
  let domain = createOrLoadDomain(node.toHex());

  if (!domain.labelName && label) {
    domain.labelName = label;
    domain.name = name;
  }
  domain.save();

  let wrappedDomain = new WrappedDomain(node.toHex());
  wrappedDomain.domain = domain.id;
  // wrappedDomain.expiryDate = event.params.expiry;
  wrappedDomain.fuses = fuses.toI32();
  wrappedDomain.owner = owner.id;
  wrappedDomain.name = name;
  wrappedDomain.save();

  let nameWrappedEvent = new NameWrapped(createEventID(event));
  nameWrappedEvent.domain = domain.id;
  nameWrappedEvent.name = name;
  nameWrappedEvent.fuses = fuses.toI32();
  // nameWrappedEvent.expiryDate = event.params.expiry;
  nameWrappedEvent.owner = owner.id;
  nameWrappedEvent.blockNumber = blockNumber;
  nameWrappedEvent.transactionID = transactionID;
  nameWrappedEvent.save();
}

export function handleNameUnwrapped(event: NameUnwrappedEvent): void {
  let node = event.params.node;
  let blockNumber = event.block.number.toI32();
  let transactionID = event.transaction.hash;
  let owner = createOrLoadAccount(event.params.owner.toHex());

  let nameUnwrappedEvent = new NameUnwrapped(createEventID(event));
  nameUnwrappedEvent.domain = node.toHex();
  nameUnwrappedEvent.owner = owner.id;
  nameUnwrappedEvent.blockNumber = blockNumber;
  nameUnwrappedEvent.transactionID = transactionID;
  nameUnwrappedEvent.save();

  store.remove("WrappedDomain", node.toHex());
}

function makeWrappedTransfer(
  blockNumber: i32,
  transactionID: Bytes,
  eventID: string,
  node: BigInt,
  to: string
): void {
  const _to = createOrLoadAccount(to);
  const namehash =
    "0x" +
    node
      .toHex()
      .slice(2)
      .padStart(64, "0");
  const domain = createOrLoadDomain(namehash);
  let wrappedDomain = WrappedDomain.load(namehash);
  // new registrations emit the Transfer` event before the NameWrapped event
  // so we need to create the WrappedDomain entity here
  if (wrappedDomain == null) {
    wrappedDomain = new WrappedDomain(namehash);
  }
  wrappedDomain.owner = _to.id;
  wrappedDomain.save();
  const wrappedTransfer = new WrappedTransfer(eventID);
  wrappedTransfer.domain = domain.id;
  wrappedTransfer.blockNumber = blockNumber;
  wrappedTransfer.transactionID = transactionID;
  wrappedTransfer.owner = _to.id;
  wrappedTransfer.save();
}

export function handleTransferSingle(event: TransferSingleEvent): void {
  makeWrappedTransfer(
    event.block.number.toI32(),
    event.transaction.hash,
    createEventID(event).concat("-0"),
    event.params.id,
    event.params.to.toHex()
  );
}

export function handleTransferBatch(event: TransferBatchEvent): void {
  let blockNumber = event.block.number.toI32();
  let transactionID = event.transaction.hash;
  let ids = event.params.ids;
  let to = event.params.to;
  for (let i = 0; i < ids.length; i++) {
    makeWrappedTransfer(
      blockNumber,
      transactionID,
      createEventID(event)
        .concat("-")
        .concat(i.toString()),
      ids[i],
      to.toHex()
    );
  }
}
