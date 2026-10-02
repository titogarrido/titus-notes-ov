import Foundation
import CoreML

// Offline ReDimNet2-B6 inference. Input contract documented in the pinned model card:
// mono 16 kHz, 6 seconds (repeat shorter clean clips), normalized 192-D embedding.
enum VoiceIdentity {
    static let modelID = "redimnet2-b6-1272aa38"
    static func signatures(directory: URL, samples: [Float], rangesJSON: String) throws -> [String: Any] {
        let ranges = try JSONSerialization.jsonObject(with: Data(rangesJSON.utf8)) as? [[String: Any]] ?? []
        guard ranges.count <= 8 else { throw error("Too many voice samples") }
        let configuration = MLModelConfiguration()
        configuration.computeUnits = .all
        let model = try MLModel(contentsOf: directory.appendingPathComponent("ReDimNet2B6.mlmodelc"), configuration: configuration)
        var signatures: [String: Any] = [:]
        for (index, range) in ranges.enumerated() {
            guard let id = range["speakerId"] as? Int, let start = range["start"] as? Double,
                  let end = range["end"] as? Double, start.isFinite, end.isFinite,
                  start >= 0, end > start, end <= Double(samples.count) / 16000 else {
                throw error("Invalid clean voice interval")
            }
            let first = Int(start * 16000), last = min(samples.count, Int(end * 16000))
            let count = last - first
            guard count >= 32000, count <= 96001 else { throw error("Voice profile requires 2–6 seconds of clean speech") }
            let clip = Array(samples[first..<last])
            guard clip.allSatisfy(\.isFinite), clip.contains(where: { abs($0) > 0.0001 }) else { throw error("Invalid or silent voice sample") }
            let input = try MLMultiArray(shape: [1, 96000], dataType: .float32)
            let pointer = input.dataPointer.assumingMemoryBound(to: Float.self)
            for i in 0..<96000 { pointer[i] = clip[i % count] }
            let output = try model.prediction(from: MLDictionaryFeatureProvider(dictionary: ["audio": MLFeatureValue(multiArray: input)]))
            guard let values = output.featureValue(for: "embedding")?.multiArrayValue, values.count == 192 else { throw error("Missing speaker embedding") }
            let vector = (0..<192).map { values[$0].floatValue }
            let norm = sqrt(vector.reduce(Float(0)) { $0 + $1 * $1 })
            guard vector.allSatisfy(\.isFinite), norm.isFinite, norm > 0.000001 else { throw error("Invalid speaker embedding") }
            signatures[String(id)] = ["model": modelID, "embedding": vector.map { $0 / norm }, "duration": Double(count) / 16000]
            try DiarizationMain.emit(["progress": Double(index + 1) / Double(max(1, ranges.count))])
        }
        return signatures
    }
    static func error(_ message: String) -> NSError {
        NSError(domain: "TitusVoiceIdentity", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
