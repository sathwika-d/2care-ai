"""
Tool definitions for Claude's tool-calling API.
Each tool maps to a scheduling service method.
"""
from typing import Any, Optional
from datetime import datetime
import structlog

logger = structlog.get_logger()

# Tool schemas for Claude
APPOINTMENT_TOOLS = [
    {
        "name": "check_availability",
        "description": "Check available appointment slots for a doctor or specialty. Use this when a patient wants to book an appointment.",
        "input_schema": {
            "type": "object",
            "properties": {
                "doctor_name": {
                    "type": "string",
                    "description": "Name of the doctor (optional, use specialty if unknown)"
                },
                "specialty": {
                    "type": "string",
                    "description": "Medical specialty e.g. 'cardiologist', 'general physician', 'dermatologist'"
                },
                "preferred_date": {
                    "type": "string",
                    "description": "Preferred date in YYYY-MM-DD format"
                },
                "preferred_time": {
                    "type": "string",
                    "description": "Preferred time e.g. 'morning', 'afternoon', 'evening' or specific like '10:00'"
                }
            },
            "required": []
        }
    },
    {
        "name": "book_appointment",
        "description": "Confirm and create a new appointment booking for the patient.",
        "input_schema": {
            "type": "object",
            "properties": {
                "patient_id": {
                    "type": "string",
                    "description": "Patient's unique ID"
                },
                "doctor_id": {
                    "type": "string",
                    "description": "Doctor's unique ID"
                },
                "slot_id": {
                    "type": "string",
                    "description": "Availability slot ID"
                },
                "notes": {
                    "type": "string",
                    "description": "Any special notes or reason for visit"
                }
            },
            "required": ["patient_id", "doctor_id", "slot_id"]
        }
    },
    {
        "name": "reschedule_appointment",
        "description": "Reschedule an existing appointment to a new time slot.",
        "input_schema": {
            "type": "object",
            "properties": {
                "appointment_id": {
                    "type": "string",
                    "description": "Existing appointment ID to reschedule"
                },
                "new_slot_id": {
                    "type": "string",
                    "description": "New availability slot ID"
                },
                "reason": {
                    "type": "string",
                    "description": "Reason for rescheduling"
                }
            },
            "required": ["appointment_id", "new_slot_id"]
        }
    },
    {
        "name": "cancel_appointment",
        "description": "Cancel an existing appointment.",
        "input_schema": {
            "type": "object",
            "properties": {
                "appointment_id": {
                    "type": "string",
                    "description": "Appointment ID to cancel"
                },
                "reason": {
                    "type": "string",
                    "description": "Reason for cancellation"
                }
            },
            "required": ["appointment_id"]
        }
    },
    {
        "name": "get_patient_history",
        "description": "Retrieve patient's appointment history and past interactions.",
        "input_schema": {
            "type": "object",
            "properties": {
                "patient_id": {
                    "type": "string",
                    "description": "Patient's unique ID"
                },
                "limit": {
                    "type": "integer",
                    "description": "Number of past records to fetch (default 3)",
                    "default": 3
                }
            },
            "required": ["patient_id"]
        }
    },
    {
        "name": "get_upcoming_appointments",
        "description": "Get a patient's upcoming scheduled appointments.",
        "input_schema": {
            "type": "object",
            "properties": {
                "patient_id": {
                    "type": "string",
                    "description": "Patient's unique ID"
                }
            },
            "required": ["patient_id"]
        }
    },
    {
        "name": "find_alternative_slots",
        "description": "Find alternative appointment slots when the requested slot is unavailable.",
        "input_schema": {
            "type": "object",
            "properties": {
                "doctor_id": {
                    "type": "string",
                    "description": "Doctor's unique ID"
                },
                "specialty": {
                    "type": "string",
                    "description": "Medical specialty as fallback"
                },
                "date_range_start": {
                    "type": "string",
                    "description": "Start of acceptable date range (YYYY-MM-DD)"
                },
                "date_range_end": {
                    "type": "string",
                    "description": "End of acceptable date range (YYYY-MM-DD)"
                }
            },
            "required": []
        }
    },
    {
        "name": "detect_and_set_language",
        "description": "Detect the language from patient's speech and update their preference.",
        "input_schema": {
            "type": "object",
            "properties": {
                "text_sample": {
                    "type": "string",
                    "description": "Sample of patient's speech to detect language"
                },
                "patient_id": {
                    "type": "string",
                    "description": "Patient ID to update preference (optional)"
                }
            },
            "required": ["text_sample"]
        }
    },
    {
        "name": "log_campaign_response",
        "description": "Log a patient's response to an outbound campaign call.",
        "input_schema": {
            "type": "object",
            "properties": {
                "campaign_record_id": {
                    "type": "string",
                    "description": "Campaign record ID"
                },
                "response": {
                    "type": "string",
                    "enum": ["confirmed", "rescheduled", "declined", "no_answer", "callback_requested"],
                    "description": "Patient's response to the campaign"
                },
                "notes": {
                    "type": "string",
                    "description": "Additional notes from the conversation"
                }
            },
            "required": ["campaign_record_id", "response"]
        }
    }
]


# Multilingual system prompts
SYSTEM_PROMPTS = {
    "en": """You are MedVoice, a warm and professional AI medical appointment assistant for 2care.ai.
You help patients book, reschedule, and cancel medical appointments through natural voice conversation.

CORE RESPONSIBILITIES:
- Book appointments efficiently (confirm doctor, specialty, date, time before booking)
- Handle rescheduling and cancellations gracefully
- Offer alternatives when slots are unavailable
- Confirm bookings clearly before executing them
- Never book in the past or double-book

CONVERSATION STYLE:
- Warm, empathetic, professional
- Concise responses (2-3 sentences max for voice)
- Always confirm critical details before actions
- If unclear, ask ONE clarifying question at a time

PATIENT CONTEXT:
{patient_context}

CURRENT SESSION:
{session_context}
""",
    "hi": """आप MedVoice हैं, 2care.ai के लिए एक गर्मजोशी और पेशेवर AI मेडिकल अपॉइंटमेंट सहायक।
आप मरीजों को प्राकृतिक बातचीत के माध्यम से चिकित्सा अपॉइंटमेंट बुक, पुनर्निर्धारित और रद्द करने में मदद करते हैं।

जब भी मरीज हिंदी में बात करें, हिंदी में जवाब दें। सरल और स्पष्ट भाषा का उपयोग करें।

मरीज का संदर्भ:
{patient_context}

वर्तमान सत्र:
{session_context}
""",
    "ta": """நீங்கள் MedVoice, 2care.ai-க்கான ஒரு இன்சர்னி மற்றும் தொழில்முறை AI மருத்துவ சந்திப்பு உதவியாளர்.
இயற்கையான குரல் உரையாடல் மூலம் நோயாளிகள் மருத்துவ சந்திப்புகளை பதிவு செய்ய, மாற்றியமைக்க மற்றும் ரத்து செய்ய உதவுகிறீர்கள்.

நோயாளி தமிழில் பேசும்போது தமிழில் பதிலளிக்கவும்.

நோயாளி சூழல்:
{patient_context}

தற்போதைய அமர்வு:
{session_context}
"""
}
