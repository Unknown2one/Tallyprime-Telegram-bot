import sys
import os
from faster_whisper import WhisperModel

# Use 'tiny' or 'base' model for a good balance of speed and accuracy on a laptop
# Hindi and English are supported
model_size = "base"

def transcribe(audio_path):
    # Run on CPU by default. Use "cuda" if you have an NVIDIA GPU.
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    
    # Optimize local transcription for Hindi
    segments, info = model.transcribe(audio_path, beam_size=5, language="hi")
    
    # Concatenate all segments into one string
    text = " ".join([segment.text for segment in segments])
    return text.strip()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python transcribe.py <path_to_audio_file>")
        sys.exit(1)
        
    audio_file = sys.argv[1]
    if not os.path.exists(audio_file):
        print(f"Error: File {audio_file} not found.")
        sys.exit(1)
        
    try:
        result = transcribe(audio_file)
        print(result)
    except Exception as e:
        print(f"Error during transcription: {str(e)}", file=sys.stderr)
        sys.exit(1)
