# T3.1 Single-Cohort Flow Simulator

## Computer Science Curriculum Progression Simulation

### Project Overview

This project simulates the progression of 100 students through the Qatar University Computer Science curriculum. The goal is to identify curriculum bottlenecks, prerequisite chains that delay students, and factors affecting graduation rates.

The simulation will model student movement semester-by-semester through the curriculum using predefined assumptions and probabilistic outcomes.

---

# Research Question

**Which prerequisite chains contribute most to student delay and non-completion in the Computer Science curriculum?**

The simulation will identify critical courses and prerequisite structures that create bottlenecks in student progression.

---

# Curriculum Structure

The simulation will be based on the actual Computer Science prerequisite structure.

## Chain 1: Programming Path

```text
CMPS 151 Programming Concepts
        ↓
CMPS 251 Object-Oriented Programming
        ↓
CMPS 303 Data Structures
        ↓
CMPS 323 Design & Analysis of Algorithms
```

## Chain 2: Systems Path

```text
CMPS 151 Programming Concepts
        ↓
CMPS 251 Object-Oriented Programming
        ↓
CMPS 303 Data Structures
        ↓
CMPS 405 Operating Systems
```

## Chain 3: Software Engineering Path

```text
CMPS 151 Programming Concepts
        ↓
CMPS 251 Object-Oriented Programming
        ↓
CMPS 350 Web Development Fundamentals
        ↓
CMPS 310 Software Engineering
        ↓
CMPS 493 Senior Project I
        ↓
CMPS 499 Senior Project II
```

---

# Simulation Design

## Student Class

```python
class Student:
    id
    current_semester
    completed_courses
    failed_courses
    gpa
    status
```

### Student Status

* Active
* Delayed
* Dropped
* Graduated

---

## Course Class

```python
class Course:
    code
    credits
    prerequisites
    pass_rate
```

### Example

```python
CMPS303 = Course(
    code="CMPS303",
    prerequisites=["CMPS251"],
    pass_rate=0.72
)
```

---

# Assumptions

All assumptions are student-authored and documented.

## Cohort

* Initial cohort size: 100 students
* Maximum study duration: 12 semesters
* Students may retake failed courses

## Course Pass Rates

| Course Type            | Pass Rate |
| ---------------------- | --------- |
| Introductory Courses   | 90%       |
| Programming Courses    | 80%       |
| Data Structures        | 70%       |
| Algorithms             | 65%       |
| Operating Systems      | 65%       |
| Senior Project Courses | 85%       |

## Dropout Rules

* Students who fail the same course three times have a 40% probability of dropping out.
* Students delayed by more than four semesters have a 20% probability of dropping out.

## Enrollment Rules

* Maximum course load per semester: 5 courses.
* Students can only enroll in courses whose prerequisites are satisfied.
* Failed courses must be retaken before progressing.

---

# Deterministic Simulation

To ensure reproducibility:

```python
import random

random.seed(42)
```

Using a fixed random seed guarantees identical results across runs.

---

# Software Architecture

```python
Student
 ├─ GPA
 ├─ completed_courses
 ├─ current_semester
 └─ status

Course
 ├─ prerequisites
 ├─ pass_rate
 └─ credits

Simulator
 ├─ generate_students()
 ├─ run_semester()
 ├─ process_failures()
 └─ produce_statistics()
```

---

# Technology Stack

## Programming Language

* Python

## Libraries

### Simulation

* NumPy

### Data Analysis

* Pandas

### Visualization

* Matplotlib
* Seaborn

### Curriculum Network Visualization

* NetworkX

### Optional Dashboard

* Streamlit

---

# Visualizations

## 1. Curriculum Network Graph

Visualize the prerequisite structure using NetworkX.

Node size will represent:

```python
students_blocked_here
```

Large red nodes indicate major bottlenecks.

---

## 2. Bottleneck Ranking

Example:

| Course   | Students Delayed |
| -------- | ---------------- |
| CMPS 303 | 34               |
| CMPS 323 | 29               |
| CMPS 405 | 21               |
| CMPS 310 | 12               |

---

## 3. Cohort Funnel

Example:

```text
100 Start

92 after Year 1

81 after Year 2

71 after Year 3

63 after Year 4

58 Graduate
```

---

## 4. Graduation Timeline

Histogram showing:

* Graduated in 8 semesters
* Graduated in 9 semesters
* Graduated in 10 semesters
* Dropped out

---

# Experimental Scenarios

## Scenario A: Current Curriculum

Baseline simulation using default assumptions.

---

## Scenario B: Improved Data Structures Pass Rate

Increase Data Structures pass rate:

```text
70% → 80%
```

Measure changes in:

* Graduation rate
* Time to graduation
* Number of delayed students

---

## Scenario C: Summer Retake Option

Allow students to retake failed courses during summer semesters.

Measure impact on:

* Graduation rate
* Average completion time
* Bottleneck severity

---

# Expected Bottlenecks

Based on curriculum structure, the following courses are expected to create the largest delays:

1. CMPS 303 Data Structures
2. CMPS 323 Design & Analysis of Algorithms
3. CMPS 405 Operating Systems
4. CMPS 310 Software Engineering

The simulation will determine whether these assumptions are supported by the results.

---

# Expected Outcomes

The project should identify:

* Courses with the highest failure impact.
* Prerequisite chains that delay progression.
* Common dropout points.
* Potential curriculum improvements.

The final report will include recommendations based on simulation results and scenario comparisons.

---

# Deliverables

## Source Code

* Student class
* Course class
* Simulator class
* Visualization scripts

## Visualizations

* Curriculum network graph
* Bottleneck ranking chart
* Cohort funnel chart
* Graduation timeline histogram

## Report (6–8 Pages)

1. Introduction
2. Problem Statement
3. Curriculum Model
4. Assumptions
5. Simulation Methodology
6. Results
7. Bottleneck Analysis
8. Scenario Comparison
9. Conclusions and Recommendations

---

# Estimated Difficulty

**7/10**

The project is technically manageable while providing meaningful analysis and clear opportunities for strong visualizations and academic discussion.
