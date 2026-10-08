import { dlopen, FFIType as T, linkSymbols, ptr, read, type Pointer } from "bun:ffi";

const shell = dlopen("shell32.dll", {
  SHGetPropertyStoreForWindow: { args: [T.ptr, T.ptr, T.ptr], returns: T.i32 },
});
const com = dlopen("ole32.dll", {
  CoInitializeEx: { args: [T.ptr, T.u32], returns: T.i32 },
  CoUninitialize: { args: [], returns: T.void },
});
const propertyStoreId = Buffer.from("eb8e6d88f28c46448d02cdba1dbdcf99", "hex");
const appPropertySet = Buffer.from("55284c9f799f394ba8d0e1d42de1d5f3", "hex");
function check(result: number, operation: string) {
  if (result < 0) throw new Error(`${operation}: 0x${(result >>> 0).toString(16)}`);
}

// IPropertyStore has the IUnknown slots followed by GetCount, GetAt,
// GetValue, SetValue, Commit. All pointers here use the Windows x64 ABI.
function writeProperties(hwnd: Pointer | bigint, values: [number, string | null][]) {
  const initialized = com.symbols.CoInitializeEx(null, 0);
  if (initialized < 0 && initialized !== -2147417850) check(initialized, "CoInitializeEx");
  try {
    const output = new BigUint64Array(1);
    check(shell.symbols.SHGetPropertyStoreForWindow(hwnd, ptr(propertyStoreId), ptr(output)), "Window property store");
    const store = Number(output[0]) as Pointer;
    const vtable = read.ptr(store);
    const methods = linkSymbols({
      setValue: { ptr: read.ptr(vtable, 6 * 8) as Pointer, args: [T.ptr, T.ptr, T.ptr], returns: T.i32 },
      release: { ptr: read.ptr(vtable, 2 * 8) as Pointer, args: [T.ptr], returns: T.u32 },
    });
    try {
      for (const [id, text] of values) {
        const key = Buffer.alloc(20);
        appPropertySet.copy(key);
        key.writeUInt32LE(id, 16);
        const value = Buffer.alloc(24); // PROPVARIANT (VT_EMPTY for removal)
        const wide = text === null ? null : Buffer.from(text + "\0", "utf16le");
        if (wide) {
          value.writeUInt16LE(31, 0); // VT_LPWSTR
          value.writeBigUInt64LE(BigInt(ptr(wide)), 8);
        }
        // SetValue copies the string. The input borrows a live JS buffer;
        // it must not be passed to PropVariantClear (which would free it).
        check(methods.symbols.setValue(store, ptr(key), ptr(value)), "Window identity property");
      }
    } finally {
      methods.symbols.release(store);
      methods.close();
    }
  } finally {
    if (initialized >= 0) com.symbols.CoUninitialize();
  }
}

export function setTaskbarIdentity(hwnd: Pointer | bigint, executable: string, icon: string) {
  // Shell requires the relaunch command and display name together, and
  // relaunch properties must precede the explicit window AppUserModelID.
  writeProperties(hwnd, [
    [2, `"${executable}"`],
    [3, `${icon},0`],
    [4, "字伴"],
    [5, "Rizum.Ziban"],
  ]);
  return () => writeProperties(hwnd, [[5, null], [2, null], [3, null], [4, null]]);
}
