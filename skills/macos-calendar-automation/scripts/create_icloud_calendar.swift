import EventKit

let store = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)

let calName = CommandLine.arguments.count > 1 
    ? CommandLine.arguments[1] 
    : "NuevoCalendario"

store.requestFullAccessToEvents { granted, error in
    guard granted else {
        print("ERROR: acceso denegado — \(error?.localizedDescription ?? "sin detalles")")
        semaphore.signal()
        exit(1)
    }
    
    guard let icloudSource = store.sources.first(where: { 
        $0.sourceType == .calDAV && $0.title.lowercased().contains("icloud") 
    }) else {
        print("ERROR: no se encontró fuente iCloud")
        semaphore.signal()
        exit(1)
    }
    
    let existing = store.calendars(for: .event).filter { $0.title == calName }
    if !existing.isEmpty {
        print("YA_EXISTE: \(calName) en \(existing.first!.source.title)")
        semaphore.signal()
        exit(0)
    }
    
    let cal = EKCalendar(for: .event, eventStore: store)
    cal.title = calName
    cal.source = icloudSource
    
    do {
        try store.saveCalendar(cal, commit: true)
        print("CREADO: \(calName) en iCloud")
    } catch {
        print("ERROR: \(error.localizedDescription)")
    }
    
    semaphore.signal()
}

semaphore.wait()
