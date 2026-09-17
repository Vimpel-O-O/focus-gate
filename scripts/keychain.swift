import Foundation
import Security

let service = "com.focusgate.openai"
let account = "openai"
let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service, kSecAttrAccount as String: account]
let command = CommandLine.arguments.dropFirst().first ?? ""
var status: OSStatus = errSecParam
if command == "set" {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard !data.isEmpty, data.count < 4096 else { exit(2) }
    status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrLabel as String] = "Focus Gate OpenAI API key"
        status = SecItemAdd(item as CFDictionary, nil)
    }
} else if command == "get" {
    SecKeychainSetUserInteractionAllowed(false)
    var lookup = query
    lookup[kSecReturnData as String] = true
    lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    status = SecItemCopyMatching(lookup as CFDictionary, &result)
    if status == errSecSuccess, let data = result as? Data {
        FileHandle.standardOutput.write(data)
    }
}
if status != errSecSuccess {
    FileHandle.standardError.write(Data("Keychain operation failed (\(status)). Run npm run setup in a terminal with your login Keychain unlocked.\n".utf8))
    exit(1)
}
