# Wrapper around scripts/generate_all_icons.py
import subprocess
import sys
import os

if __name__ == "__main__":
    script_path = os.path.join(os.path.dirname(__file__), "scripts/generate_all_icons.py")
    res = subprocess.run([sys.executable, script_path])
    sys.exit(res.returncode)
