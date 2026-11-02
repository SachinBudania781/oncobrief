import React from "react";
import { createRoot } from "react-dom/client";
import Transport from "../src/care/Transport";

createRoot(document.getElementById("root")).render(<Transport pid="PATIENT-TEST" user={{ role: "patient" }} />);
