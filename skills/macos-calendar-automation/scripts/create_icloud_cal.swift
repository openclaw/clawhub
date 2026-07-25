import EventKit

// Config: change this to the desired calendar name
let CALENDAR_NAME = "TestArgos"

let store = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)

store.requestFullAccessToEvents { granted, error in
    defer { semaphore.signal() }
    
    guard granted else {
        print("ERROR: acceso TCC denegado — \(error?.localizedDescription ?? "sin detalles")")
        exit(1)
    }
    
    // Find iCloud source (CalDAV type)
    guard let icloudSource = store.sources.first(where: {
        $0.sourceType == .calDAV && $0.title.lowercased().contains("icloud")
    }) else {
        print("ERROR: no se encontró fuente iCloud (CalDAV)")
        exit(1)
    }
    
    print("Fuente iCloud: \(icloudSource.title) (id: \(icloudSource.sourceIdentifier))")
    
    // Check if already exists
    let existing = store.calendars(for: .event).filter { $0.title == CALENDAR_NAME }
    if !existing.isEmpty {
        print("YA EXISTE: \(existing.first!.title) en source \(existing.first!.source.title)")
        exit(0)
    }
    
    // Create calendar on iCloud
    let cal = EKCalendar(for: .event, eventStore: store)
    cal.title = CALENDAR_NAME
    cal.source = icloudSource
    
    do {
        try store.saveCalendar(cal, commit: true)
        print("CREADO: \(cal.title) en \(cal.source.title)")
    } catch {
        print("ERROR al crear: \(error.localizedDescription)")
        exit(1)
    }
}

semaphore.wait()
