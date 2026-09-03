/** Shared constants for the SD UI Widget Builder system subsystem. */

export const MODULE_ID = "sd";
export const SOCKET_NS = `system.${MODULE_ID}`;

/** Module settings keys. */
export const SETTINGS = {
  /** Who may push a widget onto other clients: "gm" | "all". */
  broadcastPolicy: "broadcastPolicy"
};

/** Audience choices for Call/Open UI Widget. */
export const AUDIENCES = {
  self: "self",              // the client that ran the graph / macro
  gm: "gm",                  // every GM client
  owners: "owners",          // users owning the context actor
  players: "players",        // all non-GM users
  everyone: "everyone",      // all connected users
  users: "users"             // explicit user id / name list
};

export const AUDIENCE_CHOICES = [
  { value: AUDIENCES.self,     label: "SDUI.Audience.Self" },
  { value: AUDIENCES.gm,       label: "SDUI.Audience.GM" },
  { value: AUDIENCES.owners,   label: "SDUI.Audience.Owners" },
  { value: AUDIENCES.players,  label: "SDUI.Audience.Players" },
  { value: AUDIENCES.everyone, label: "SDUI.Audience.Everyone" },
  { value: AUDIENCES.users,    label: "SDUI.Audience.Users" }
];

export const LAYOUTS = ["window", "fullscreen", "dock-left", "dock-right", "dock-top", "dock-bottom"];
