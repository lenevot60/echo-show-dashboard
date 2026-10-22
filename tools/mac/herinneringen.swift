// Open reminders as JSON on stdout, through EventKit (fast; AppleScript takes up to a minute).
// Build: swiftc -O -o tools/mac/bin/herinneringen tools/mac/herinneringen.swift
// The first run asks macOS for access to Reminders.
import EventKit
import Foundation

let store = EKEventStore()
let wacht = DispatchSemaphore(value: 0)
var toegang = false
if #available(macOS 14.0, *) {
    store.requestFullAccessToReminders { ok, _ in toegang = ok; wacht.signal() }
} else {
    store.requestAccess(to: .reminder) { ok, _ in toegang = ok; wacht.signal() }
}
_ = wacht.wait(timeout: .now() + 120)
guard toegang else {
    FileHandle.standardError.write("geen toegang tot Herinneringen\n".data(using: .utf8)!)
    exit(2)
}

let iso = ISO8601DateFormatter()
let filter = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
var uit: [[String: Any]] = []
let klaar = DispatchSemaphore(value: 0)
store.fetchReminders(matching: filter) { lijst in
    for r in lijst ?? [] {
        var item: [String: Any] = [
            "titel": r.title ?? "",
            "lijst": r.calendar?.title ?? "",
            "prio": r.priority,
            "vlag": false,
            "due": NSNull(),
            "heeftTijd": false,
        ]
        if let dc = r.dueDateComponents, let d = Calendar.current.date(from: dc) {
            item["due"] = iso.string(from: d)
            item["heeftTijd"] = dc.hour != nil
        }
        uit.append(item)
    }
    klaar.signal()
}
_ = klaar.wait(timeout: .now() + 60)
let data = try JSONSerialization.data(withJSONObject: uit)
FileHandle.standardOutput.write(data)
