import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  V1Camporee,
  V1Cartridge,
  V1Game,
  V1Input,
} from "@camporee-conductor/cartridge";
import { strFromU8, unzipSync } from "fflate";

/** The file isn't a readable v1 cartridge. */
export class CartridgeReadError extends Error {
  override name = "CartridgeReadError";
}

/**
 * Reads a v1 cartridge from a zip (v1 Composer's Export) or a v1 workspace directory: camporee.json,
 * presets.json, games/*.json and, if present, assets/. Nothing is validated here; the importer does that.
 */
export function readV1Cartridge(path: string): V1Cartridge {
  return statSync(path).isDirectory() ? readDirectory(path) : readZip(path);
}

function readDirectory(dir: string): V1Cartridge {
  const read = (file: string): unknown =>
    JSON.parse(readFileSync(join(dir, file), "utf8"));
  const list = (sub: string): string[] => {
    try {
      return readdirSync(join(dir, sub)).sort();
    } catch {
      return [];
    }
  };
  return {
    camporee: read("camporee.json") as V1Camporee,
    presets: read("presets.json") as V1Input[],
    games: list("games")
      .filter((f) => f.endsWith(".json"))
      .map((f) => read(join("games", f)) as V1Game),
    assetNames: list("assets"),
  };
}

function readZip(path: string): V1Cartridge {
  return readV1Zip(new Uint8Array(readFileSync(path)), path);
}

/** A v1 cartridge from zip bytes (an upload, #100); `label` names it in errors. */
export function readV1Zip(bytes: Uint8Array, label: string): V1Cartridge {
  const path = label;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new CartridgeReadError(`${label}: not a zip file`);
  }
  const names = Object.keys(entries);
  // v1 puts camporee.json at the root; tolerate one enclosing folder (a re-zipped download).
  const manifest =
    names.find((n) => n === "camporee.json") ??
    names.find((n) => /^[^/]+\/camporee\.json$/.test(n));
  if (!manifest) {
    throw new CartridgeReadError(
      `${path}: no camporee.json, so not a v1 cartridge`,
    );
  }
  const root = manifest.slice(0, -"camporee.json".length);
  const json = (name: string): unknown => {
    const data = entries[`${root}${name}`];
    if (!data)
      throw new CartridgeReadError(`${path}: no ${name} in the cartridge`);
    return JSON.parse(strFromU8(data));
  };
  const under = (folder: string) =>
    names
      .filter((n) => n.startsWith(`${root}${folder}/`) && !n.endsWith("/"))
      .map((n) => n.slice(`${root}${folder}/`.length))
      .sort();
  return {
    camporee: json("camporee.json") as V1Camporee,
    presets: json("presets.json") as V1Input[],
    games: under("games")
      .filter((f) => f.endsWith(".json"))
      .map((f) => json(`games/${f}`) as V1Game),
    assetNames: under("assets"),
  };
}
