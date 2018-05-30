/*---------------------------------------------------------------------------------------------
|  $Copyright: (c) 2018 Bentley Systems, Incorporated. All rights reserved. $
*--------------------------------------------------------------------------------------------*/
/** @module Portability */

import * as path from "path";
import * as os from "os";

/** Information about the platform on which the app is running. Also see [[KnownLocations]] and [[IModelJsFs]]. */
export class Platform {
  /** The imodeljs mobile info object, if this is running in the imodeljs mobile platform. */
  public static get imodeljsMobile(): any {
    return (typeof (self) !== "undefined") ? (self as any).imodeljsMobile : undefined;
  }

  /** Get the name of the platform. Possible return values are: "win32", "linux", "darwin", "ios", "android", or "uwp". */
  public static get platformName(): string {

    if (Platform.imodeljsMobile !== undefined) {
      // TBD: Platform.imodeljsMobile.platform should indicate which mobile platform this is.
      return "iOS";
    } else {
      // This is node or electron. See what underlying OS we are on:
      return process.platform;
    }
  }

  /** The Electron info object, if this is running in Electron. */
  public static get electron(): any {
    return ((typeof (process) !== "undefined") && ("electron" in process.versions)) ? require("electron") : undefined;
  }

  /** Query if this is a desktop configuration */
  public static isDesktop(): boolean {
    return Platform.electron !== undefined;
  }

  /** Query if this is a mobile configuration */
  public static isMobile(): boolean {
    return Platform.imodeljsMobile !== undefined;
  }

  /** Query if this is running in nodejs  */
  public static isNodeJs(): boolean {
    return !Platform.isMobile(); // currently we use nodejs for all non-mobile backend apps
  }
}

/** Well known directories that may be used by the app. Also see [[Platform]] */
export class KnownLocations {

  /** The directory where the platform's assets are stored. */
  public static get platformAssetsDir(): string {
    const imodeljsMobile = Platform.imodeljsMobile;
    if (imodeljsMobile !== undefined) {
      return path.join(imodeljsMobile.knownLocations.packageAssetsDir, "imodeljs-backend");
    }

    // Assume that we are running in nodejs
    return path.join(__dirname, "assets");
  }

  /** The temp directory. */
  public static get tmpdir(): string {
    const imodeljsMobile = Platform.imodeljsMobile;
    if (imodeljsMobile !== undefined) {
      return imodeljsMobile.knownLocations.tempDir;
    }

    // Assume that we are running in nodejs
    return os.tmpdir();
  }
}
