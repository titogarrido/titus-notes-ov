import Foundation

// JSON lines over stdout; audio and model paths are passed as separate argv entries.
// This helper has no networking: the Rust host owns model downloads and cancellation.
@main
enum DiarizationMain {
    static func emit(_ payload: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    }

    static func main() {
        do {
            guard CommandLine.arguments.count == 3 else {
                throw NSError(domain: "TitusDiarization", code: 1,
                              userInfo: [NSLocalizedDescriptionKey: "Expected model directory and mono 16 kHz Float32 audio"])
            }
            let model = try Nemotron3Diarizer.fromCoreMLDirectory(
                URL(fileURLWithPath: CommandLine.arguments[1]))
            let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
            guard !data.isEmpty, data.count % 4 == 0 else {
                throw NSError(domain: "TitusDiarization", code: 2,
                              userInfo: [NSLocalizedDescriptionKey: "Invalid Float32 audio"])
            }
            let samples = data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
            let result = try model.diarize(audio: samples, sampleRate: 16_000) { progress in
                try? emit(["progress": progress])
            }
            try emit(["segments": result.segments.map {
                ["start": $0.startTime, "end": $0.endTime, "speakerId": $0.speakerId] as [String: Any]
            }])
        } catch {
            try? emit(["error": error.localizedDescription])
            exit(1)
        }
    }
}
