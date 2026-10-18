Here is a complete setup and troubleshooting guide you can hand directly to your teammate so they can get the entire pipeline running on their laptop, along with the exact fixes if their OS fails to recognize the hardware.



\---



\# Hridaya Vacha — Setup \& Running Guide



This project consists of three services running concurrently:



1\. \*\*Inference Backend (Docker, Port 8000):\*\* Runs neural network classification and signal processing pipelines.

2\. \*\*Host Hardware Bridge (Python FastAPI, Port 8001):\*\* Interacts directly with the physical USB serial port (`/dev/ttyUSB\*` or `COM\*`) and forwards data to Docker.

3\. \*\*Frontend Dashboard (React/Vite, Port 5173):\*\* User interface for patient records and real-time recording control.



\---



\## 1. Prerequisites Checklist



Ensure the following tools are installed:



\* \*\*Docker \& Docker Compose\*\* (or Docker Desktop on Windows/macOS)

\* \*\*Node.js\*\* (v18+) and `npm`

\* \*\*Python\*\* (v3.10+)

\* A \*\*data-capable USB cable\*\* (charge-only cables will power the board but will not transmit data)



\---



\## 2. Step-by-Step Setup \& Launch



1\. \*\*Start the AI Inference Backend (Docker):\*\* Terminal 1.

From the root of the project directory:



```bash

\# If using Docker Compose:

docker compose up -d



\# Or if running the existing built image directly:

docker run -d --name hridaya-backend -p 8000:8000 hridaya-vacha-backend:latest



```



\*Verification:\* Run `curl -I http://localhost:8000/docs`. It must return `HTTP/1.1 200 OK`.





2\. \*\*Launch the Host Hardware Bridge:\*\* Terminal 2.

Open a new terminal tab to run the USB serial proxy:



```bash

cd backend

python3 -m venv ../.venv

source ../.venv/bin/activate        # On Windows: ..\\.venv\\Scripts\\activate

pip install -r requirements.txt

python src/ui\_bridge.py



```



\*Verification:\* The console should state `Uvicorn running on \[http://0.0.0.0:8001](http://0.0.0.0:8001)`.





3\. \*\*Start the Frontend Client:\*\* Terminal 3.

Open a third terminal tab:



```bash

cd frontend

npm install

npm run dev



```



\*Verification:\* Open `http://localhost:5173` in your browser. The dashboard should load, and the hardware panel should state `Connected`.





\---



\## 3. Hardware Troubleshooting (If Device Is Not Detected)



If the hardware shows `Hardware not detected` or `Disconnected` on their machine, follow the platform-specific instructions below:



\### If Your Teammate Uses Linux (Ubuntu / Fedora / Arch)



1\. \*\*Check if the OS registers the chip on the USB bus:\*\*

```bash

lsusb



```





\*Look for:\* An entry containing `FT232 Serial (UART) IC` (Vendor ID `0403:6001`) or `Silicon Labs / CH340 / QinHeng`.

2\. \*\*Disable the `brltty` conflict (Most Common on Modern Linux):\*\*

Linux often assumes FTDI chips are braille displays and blocks them from binding as serial ports.

```bash

sudo systemctl stop brltty-udev.service brltty.service 2>/dev/null

sudo systemctl mask brltty-udev.service brltty.service 2>/dev/null



```





3\. \*\*Ensure the serial driver is loaded:\*\*

```bash

sudo modprobe ftdi\_sio

echo "0403 6001" | sudo tee /sys/bus/usb-serial/drivers/ftdi\_sio/new\_id



```





4\. \*\*Add permanent read/write permissions \& create port alias:\*\*

```bash

echo 'SUBSYSTEM=="tty", ATTRS{idVendor}=="0403", ATTRS{idProduct}=="6001", MODE="0666", SYMLINK+="hridaya\_vacha"' | sudo tee /etc/udev/rules.d/99-hridaya.rules

sudo usermod -a -G dialout $USER

sudo udevadm control --reload-rules

sudo udevadm trigger



```





\*Verification:\* Unplug and replug the USB cable, then run `ls -l /dev/hridaya\* /dev/ttyUSB\*`. You should see `/dev/hridaya\_vacha -> ttyUSB0`.



\---



\### If Your Teammate Uses Windows



1\. \*\*Install FTDI VCP Drivers:\*\*

Windows often does not automatically bind FT232 UART chips.

\* Download and run the setup executable from \[FTDI Official VCP Drivers](https://ftdichip.com/drivers/vcp-drivers/).





2\. \*\*Identify the COM Port:\*\*

\* Press `Win + X` and select \*\*Device Manager\*\*.

\* Expand \*\*Ports (COM \& LPT)\*\* and look for `USB Serial Port (COMx)`.

\* If it appears under \*Other Devices\* with a yellow warning triangle, right-click, select \*\*Update driver\*\*, and choose search automatically.





3\. \*\*Verify in Bridge:\*\*

The bridge script auto-detects `COM\*` ports. Run `curl http://localhost:8001/api/hardware/status` in PowerShell; it should report `"connected": true` with your COM port.



\---



\### If Your Teammate Uses macOS



1\. \*\*Driver Setup:\*\*

Modern macOS has built-in FTDI drivers (`com.apple.driver.AppleUSBFTDI`). If blocked:

\* Go to \*\*System Settings > Privacy \& Security\*\* and approve any blocked system extensions.





2\. \*\*Verify Device:\*\*

```bash

ls /dev/cu.usbserial\*



```





The bridge will auto-detect `/dev/cu.usbserial\*` or `/dev/tty.usbserial\*`.

