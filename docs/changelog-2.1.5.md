# System Director 2.1.5

## Set Value: target-aware variables

- The **Variable** picker now follows the target document: Actor targets show Actor variables, Item targets show Item variables, and shared variables remain available in both cases.
- **Auto — graph owner** keeps the expected default: Actor Blueprint graphs write to that Actor; Item Blueprint graphs write to that Item.
- Added explicit **Actor — self / item owner**, **Item — current graph item**, and **Owned Item — from current actor** targets.
- Owned Items can be selected directly in Actor graphs. A connected **Actor / Item Ref** still has highest priority and can resolve an Actor, Item, Token, UUID, ID, or owned-item name.
- Dynamic Ref and UUID targets expose both Actor and Item variables because their document type is decided at runtime.
- Runtime now rejects an Actor-only variable on an Item (and vice versa) instead of silently writing an invalid value.
- Existing Set Value nodes using the old `self`, target, token, or UUID modes remain compatible.
