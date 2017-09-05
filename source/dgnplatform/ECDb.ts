import { DbResult, OpenMode } from "@bentley/bentleyjs-core/lib/BeSQLite";
import { ECJsonTypeMap, ECInstance } from "@bentley/bentleyjs-core/lib/ECJsonTypeMap";
import { loadNodeAddon } from "./addonLoader";
import { BentleyPromise, BentleyReturn } from "@bentley/bentleyjs-core/lib/Bentley";

const dgnDbNodeAddon = loadNodeAddon();

/** ECPrimitive types (Match this to ECN::PrimitiveType in ECObjects.h) */
export const enum PrimitiveTypeCode {
  Uninitialized = 0x00,
  Binary = 0x101,
  Boolean = 0x201,
  DateTime = 0x301,
  Double = 0x401,
  Integer = 0x501,
  Long = 0x601,
  Point2d = 0x701,
  Point3d = 0x801,
  String = 0x901,
}

/** Value type  (Match this to ECN::ValueKind in ECObjects.h) */
export const enum ValueKind {
  /** The ECValue has not be initialized yet */
  Uninitialized = 0x00,
  /** The ECValue holds a Primitive type */
  Primitive = 0x01,
  /** The ECValue holds a struct */
  Struct = 0x02,
  /** The ECValue holds an array */
  Array = 0x04,
  /** The ECValue holds a navigation type */
  Navigation = 0x08,
}

/** ECValue invariant */
export class ECValue {
  public kind: ValueKind;
  public type: PrimitiveTypeCode;
  public value: null | PrimitiveType | StructType | ArrayType;
}

/** Value types */
export interface Point2dType { x: number; y: number; }
export interface Point3dType { x: number; y: number; z: number; }
export type PrimitiveType = string | number | boolean | Point2dType | Point3dType;
export interface StructType {
  [index: string]: ECValue;
}
export type ArrayType = ECValue[];

/** Types that can be used for binding paramter values */
export type BindingValue = null | PrimitiveType | ECValue;

/** Custom type guard for Point2dType  */
export function isPoint2dType(arg: any): arg is Point2dType {
  return arg.x !== undefined && arg.y !== undefined && arg.z === undefined;
}

/** Custom type guard for Point3dType  */
export function isPoint3dType(arg: any): arg is Point3dType {
  return arg.x !== undefined && arg.y !== undefined && arg.z !== undefined;
}

/** Allows performing CRUD operations in an ECDb */
export class ECDb {
  private ecdb: any;

  /**
   * Create an ECDb
   * @param pathname  The pathname of the Db.
   * @return Promise that resolves to an object that contains an error property if the operation failed.
   */
  public async createDb(pathname: string): BentleyPromise<DbResult, void> {
    if (!this.ecdb)
      this.ecdb = await new dgnDbNodeAddon.ECDb();
    return await this.ecdb.createDb(pathname);
  }

  /**
   * Open the ECDb.
   * @param pathname The pathname of the Db
   * @param mode  Open mode
   * @return Promise that resolves to an object that contains an error property if the operation failed.
   */
  public async openDb(pathname: string, mode: OpenMode = OpenMode.Readonly): BentleyPromise<DbResult, void> {
    if (!this.ecdb)
      this.ecdb = await new dgnDbNodeAddon.ECDb();
    return await this.ecdb.openDb(pathname, mode);
  }

  /** Returns true if the ECDb is open */
  public isDbOpen(): boolean {
    return this.ecdb && this.ecdb.IsDbOpen;
  }

  /**
   * Close the Db after saving any uncommitted changes.
   * @return Promise that resolves to an object that contains an error property if the operation failed.
   * If the Db is not already open it's considered as an error.
   */
  public async closeDb(): BentleyPromise<DbResult, void> {
    if (!this.ecdb)
      return { error: { status: DbResult.BE_SQLITE_ERROR, message: "ECDb must be created or opened to complete this operation" } };

    return await this.ecdb.closeDb();
  }

  /**
   * Commit the outermost transaction, writing changes to the file. Then, restart the transaction.
   * @param changeSetName The name of the operation that generated these changes.
   * @return Promise that resolves to an object that contains an error property if the operation failed.
   */
  public async saveChanges(changeSetName?: string): BentleyPromise<DbResult, void> {
    if (!this.ecdb)
      return { error: { status: DbResult.BE_SQLITE_ERROR, message: "ECDb must be created or opened to complete this operation" } };

    return this.ecdb.saveChanges(changeSetName);
  }

  /**
   * Abandon (cancel) the outermost transaction, discarding all changes since last save. Then, restart the transaction.
   * @return Promise that resolves to an object that contains an error property if the operation failed.
   */
  public async abandonChanges(): BentleyPromise<DbResult, void> {
    if (!this.ecdb)
      return { error: { status: DbResult.BE_SQLITE_ERROR, message: "ECDb must be created or opened to complete this operation" } };

    return this.ecdb.abandonChanges();
  }

  /**
   * Import a schema
   * Note that if the import was successful, the database is automatically saved to disk.
   * @return Promise that resolves to an object that contains an error if the operation failed.
   * Check the existence of the error property to determine if the operation was successful.
   */
  public async importSchema(pathname: string): BentleyPromise<DbResult, void> {
    if (!this.ecdb)
      return { error: { status: DbResult.BE_SQLITE_ERROR, message: "ECDb must be created or opened to complete this operation" } };

    return this.ecdb.importSchema(pathname);
  }

  /**
   * Insert an instance
   * @description This method is not meant for bulk inserts
   * @return Promise that resolves to an object with a result property set to the id of the inserted instance.
   * The resolved object contains an error property if the operation failed.
   */
  public async insertInstance<T extends ECInstance>(typedInstance: T): BentleyPromise<DbResult, void> {
    if (!this.ecdb)
      return { error: { status: DbResult.BE_SQLITE_ERROR, message: "ECDb must be created or opened to complete this operation" } };

    const jsonInstance: any = ECJsonTypeMap.toJson<T>("ecdb", typedInstance);
    if (!jsonInstance)
      return { error: { status: DbResult.BE_SQLITE_ERROR, message: "Error writing instance as JSON" } };

    const { error, result: id } = await this.ecdb.insertInstance(JSON.stringify(jsonInstance));
    if (error)
      return { error };

    typedInstance.id = id;
    return {};
  }

  /**
   * Read an instance
   * @description This method is not meant for bulk reads.
   * @return Promise that resolves to an object with a result property set to the instance that was read from the Db.
   * The resolved object contains an error property if the operation failed.
   */
  public async readInstance<T extends ECInstance>(typedInstanceKey: T): BentleyPromise<DbResult, T> {
    if (!this.ecdb)
      return { error: { status: DbResult.BE_SQLITE_ERROR, message: "ECDb must be created or opened to complete this operation" } };

    const jsonInstanceKey: any = ECJsonTypeMap.toJson<T>("ecdb", typedInstanceKey);
    if (!jsonInstanceKey)
      throw Error("Invalid key. Check that the typescript class is mapped to JSON properly");

    const { error, result: untypedInstanceStr } = await this.ecdb.readInstance(JSON.stringify(jsonInstanceKey));
    if (error)
      return { error };

    const untypedInstance = JSON.parse(untypedInstanceStr);

    const typedConstructor = Object.getPrototypeOf(typedInstanceKey).constructor;
    const typedInstance: T | undefined = ECJsonTypeMap.fromJson<T>(typedConstructor, "ecdb", untypedInstance);
    if (!typedInstance)
      return { error: { status: DbResult.BE_SQLITE_ERROR, message: "Error reading instance" } };

    return { result: typedInstance };
  }

  /**
   * Update an instance
   * @description This method is not meant for bulk updates
   * @return Promise that resolves to an object that contains an error property if the operation failed.
   */
  public async updateInstance<T extends ECInstance>(typedInstance: T): BentleyPromise<DbResult, void> {
    if (!this.ecdb)
      return { error: { status: DbResult.BE_SQLITE_ERROR, message: "ECDb must be created or opened to complete this operation" } };

    const untypedInstance: any = ECJsonTypeMap.toJson<T>("ecdb", typedInstance);
    return await this.ecdb.updateInstance(JSON.stringify(untypedInstance));
  }

  /**
   * Delete an instance
   * @description This method is not meant for bulk deletes
   * @return Promise that resolves to an object that contains an error property if the operation failed.
   */
  public async deleteInstance<T extends ECInstance>(typedInstanceKey: T): BentleyPromise<DbResult, void> {
    if (!this.ecdb)
      return { error: { status: DbResult.BE_SQLITE_ERROR, message: "ECDb must be created or opened to complete this operation" } };

    const jsonInstanceKey: any = ECJsonTypeMap.toJson<T>("ecdb", typedInstanceKey);
    return await this.ecdb.deleteInstance(JSON.stringify(jsonInstanceKey));
  }

  /**
   * Check if an instance exists
   * @return Promise that resolves to an object with a result property set to true or false depending on whether the Db contains the instance with the specified key.
   * The resolved object contains an error property if the operation failed.
   */
  public async containsInstance<T extends ECInstance>(typedInstanceKey: T): BentleyPromise<DbResult, boolean> {
    if (!this.ecdb)
      return { error: { status: DbResult.BE_SQLITE_ERROR, message: "ECDb must be created or opened to complete this operation" } };

    const jsonInstanceKey: any = ECJsonTypeMap.toJson<T>("ecdb", typedInstanceKey);
    return this.ecdb.containsInstance(JSON.stringify(jsonInstanceKey));
  }

  private static getPrimitiveType(bindingValue: BindingValue): PrimitiveTypeCode {
    if (typeof bindingValue === "string")
      return PrimitiveTypeCode.String;
    if (typeof bindingValue === "number")
      return PrimitiveTypeCode.Integer;
    if (typeof bindingValue === "boolean")
      return PrimitiveTypeCode.Boolean;
    if (isPoint2dType(bindingValue))
      return PrimitiveTypeCode.Point2d;
    if (isPoint3dType(bindingValue))
      return PrimitiveTypeCode.Point3d;

    return PrimitiveTypeCode.Uninitialized;
  }

  private static convertToECValue(bindingValue: BindingValue | undefined): ECValue | undefined {
    if (typeof bindingValue === "undefined")
      return undefined;

    if (!bindingValue)
      return { kind: ValueKind.Uninitialized, type: PrimitiveTypeCode.Uninitialized, value: null }; // explicit binding to null

    if (bindingValue instanceof ECValue)
      return bindingValue;

    const primitiveType = ECDb.getPrimitiveType(bindingValue);
    if (primitiveType === PrimitiveTypeCode.Uninitialized)
      return undefined;

    return { kind: ValueKind.Primitive, type: primitiveType, value: bindingValue };
  }

  /**
   * Helper utility to pre-process bindings to standardize them into a fixed format containing ECValue-s
   * @param bindings Array or map of bindings
   * @return Array or map of ECValue-s.
   */
  private static preProcessBindings(bindings: Map<string, BindingValue> | BindingValue[]): BentleyReturn<DbResult, ECValue[] | Map<string, ECValue>> {
    if (bindings instanceof Array) {
      const ret = new Array<ECValue>();
      for (let ii = 0; ii < bindings.length; ii++) {
        const bindingValue = bindings[ii];
        const ecValue = ECDb.convertToECValue(bindingValue);
        if (!ecValue)
          return { error: { status: DbResult.BE_SQLITE_ERROR, message: `Invalid binding [${ii}]=${bindingValue}` } };
        ret.push(ecValue);
      }
      return { result: ret };
    }

    if (bindings instanceof Map) {
      const ret = new Map<string, ECValue>();
      for (const key of bindings.keys()) {
        const bindingValue = bindings.get(key);
        const ecValue = ECDb.convertToECValue(bindingValue);
        if (!ecValue)
          return { error: { status: DbResult.BE_SQLITE_ERROR, message: `Invalid binding [${key}]=${bindingValue}` } };
        ret.set(key, ecValue);
      }
      return { result: ret };
    }

    return { error: { status: DbResult.BE_SQLITE_ERROR, message: `Bindings must be specified as an array or a map` } };
  }

  /**
   * Execute an ECSql query returning all rows as an array of objects in JSON syntax.
   * @return all rows in JSON syntax or the empty string if nothing was selected
   * @todo Extend bindings to other types.
   * @todo Simplify binding of values to ECSQL statements.
   * The bindings parameter includes meta-data information in some cases now, but the typical consumer
   * shouldn't be bothered to pass this information. The information may be available when the ECSQL is
   * parsed, even if it's not exposed through the IECSqlBinder interface. Needs some implementation.
   * @todo Consider writing Guid-s as Blobs. Guids are serialized as strings now, but they may need to
   * be written as blobs for performance (see the ECSqlStatement API). Note that even if we did want
   * to do this, the Guid type information is not part of the EC meta data.
   * @return Promise that resolves to an object with a result property set to a JSON array containing the rows returned from the query
   * The resolved object contains an error property if the operation failed.
   */
  public async executeQuery(ecsql: string, bindings?: BindingValue[]): BentleyPromise<DbResult, string>;
  public async executeQuery(ecsql: string, bindings?: Map<string, BindingValue>): BentleyPromise<DbResult, string>;
  public async executeQuery(ecsql: string, bindings?: BindingValue[] | Map<string, BindingValue>): BentleyPromise<DbResult, string> {
    if (!this.ecdb)
      return { error: { status: DbResult.BE_SQLITE_ERROR, message: "ECDb must be created or opened to complete this operation" } };

    let ecBindingsStr: string | undefined;
    if (bindings) {
      const { error, result: ecBindings } = ECDb.preProcessBindings(bindings);
      if (error)
        return { error };
      ecBindingsStr = JSON.stringify(ecBindings);
    }

    return this.ecdb.executeQuery(ecsql, ecBindingsStr);
  }

  /**
   * Execute an ECSql statement
   * @param ecsql ECSql string
   * @param bindings Optional bindings required to execute the statement.
   * @return Promise that resolves to an object that contains an error property if the operation failed.
   * If the operation was successful and it was an insert, the returned object will contain a result property set to the id of the inserted instance.
   */
  public async executeStatement(ecsql: string, isInsertStatement?: boolean, bindings?: BindingValue[]): BentleyPromise<DbResult, string>;
  public async executeStatement(ecsql: string, isInsertStatement?: boolean, bindings?: Map<string, BindingValue>): BentleyPromise<DbResult, string>;
  public async executeStatement(ecsql: string, isInsertStatement?: boolean, bindings?: BindingValue[] | Map<string, BindingValue>): BentleyPromise<DbResult, string> {
    if (!this.ecdb)
      return { error: { status: DbResult.BE_SQLITE_ERROR, message: "ECDb must be created or opened to complete this operation" } };

    let ecBindingsStr: string | undefined;
    if (bindings) {
      const { error, result: ecBindings } = ECDb.preProcessBindings(bindings);
      if (error)
        return { error };
      ecBindingsStr = JSON.stringify(ecBindings);
    }

    return this.ecdb.executeStatement(ecsql, isInsertStatement, ecBindingsStr);
  }
}
